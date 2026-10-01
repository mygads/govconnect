/**
 * EVAL multi-turn — slot FSM across turns + deterministic VERIFY lane.
 *
 * Covers: collect → merge → completeness → deterministic VERIFY summary →
 * pending mutation minting, plus a correction turn inside VERIFY.
 * All deterministic — no LLM involved.
 */
import {
  INTENT_SLOT_KEY,
  buildPendingMutation,
  extractSlotsDeterministic,
  isCollectComplete,
  mergeSlots,
  nextMissingSlot,
  renderVerifySummary,
  type Slots,
} from '../../pipeline/slot-fsm';
import { runStagedTurn, type StagedAgentInput } from '../../pipeline/staged-agent';
import { check, evalContext, mockCallLlm } from '../support';
import type { EvalCase } from '../types';

function stagedInput(message: string, stage: 'VERIFY', slots: Slots): StagedAgentInput {
  const ctx = evalContext(`eval-m-${Date.now()}`);
  ctx.slots = { ...slots };
  return {
    message,
    decision: { stage, source: 'deterministic', confidence: 1, reasons: [] },
    ctx,
    villageName: 'Desa',
  };
}

export const cases: EvalCase[] = [
  {
    id: 'EVAL-M01',
    category: 'multi-turn',
    input: 'lampu jalan mati di depan balai desa RT 01/RW 02',
    expect: '2-turn collect → complete → VERIFY summary → create_complaint pending mutation',
    description: 'Full complaint collect across two turns, then pending mutation with rt_rw',
    run: async () => {
      // Turn 1: citizen reports; category + location extracted, description missing.
      const t1 = 'lampu jalan mati di depan balai desa RT 01/RW 02';
      let slots: Slots = { [INTENT_SLOT_KEY]: 'complaint' };
      const ext1 = extractSlotsDeterministic(t1, 'complaint');
      const m1 = mergeSlots('complaint', slots, ext1);
      slots = m1.slots;
      check(slots.category === 'penerangan jalan', `t1 category wrong: '${slots.category}'`);
      check(!!slots.location, 't1 should extract a location');
      const missing = nextMissingSlot('complaint', slots);
      check(missing?.name === 'description',
        `t1 should still need description, next missing = '${missing?.name}'`);
      check(missing && missing.prompt.length > 0, 't1 missing slot must carry a follow-up prompt');
      check(!isCollectComplete('complaint', slots), 't1 must not be complete yet');

      // Turn 2: citizen answers the description prompt.
      const t2 = 'sudah seminggu mati, warga takut keluar malam';
      const ext2 = extractSlotsDeterministic(t2, 'complaint', 'description');
      const m2 = mergeSlots('complaint', slots, ext2);
      check(m2.errors.length === 0, `t2 merge errors: ${JSON.stringify(m2.errors)}`);
      slots = m2.slots;
      check(isCollectComplete('complaint', slots), 't2 collect should be complete');
      check(slots.description === t2, `description mismatch: '${slots.description}'`);

      // VERIFY: deterministic summary rendered by code, never the model.
      const summary = renderVerifySummary('complaint', slots);
      check(summary.includes('Mohon periksa kembali laporan Anda'), 'summary must use the laporan title');
      check(summary.includes('penerangan jalan'), 'summary must contain the category');
      check(summary.includes('RT 01/RW 02'), 'summary must contain the location');

      // Pending mutation: deterministic planner → concrete tool call.
      const mutation = buildPendingMutation('complaint', slots);
      check(mutation !== null, 'pending mutation must be built');
      check(mutation!.tool === 'create_complaint', `wrong tool: ${mutation!.tool}`);
      check(mutation!.args.rt_rw === 'RT 01/RW 02',
        `rt_rw must be normalized from location, got '${mutation!.args.rt_rw}'`);
      check(mutation!.args.deskripsi === t2, 'deskripsi must equal the captured description');
    },
  },
  {
    id: 'EVAL-M02',
    category: 'multi-turn',
    input: 'mau bikin surat keterangan domisili',
    expect: 'service_request collect → complete → create_service_request pending mutation',
    description: 'Service-request collect (micro-assessor slot) → pending mutation',
    run: async () => {
      const slots: Slots = { [INTENT_SLOT_KEY]: 'service_request' };
      // The deterministic extractor has no service branch; the service slug
      // arrives from the (mocked here) assessor layer.
      const m = mergeSlots('service_request', slots, { service_slug: 'surat keterangan domisili' });
      check(m.errors.length === 0, `merge errors: ${JSON.stringify(m.errors)}`);
      const done = m.slots;
      check(nextMissingSlot('service_request', done) === null, 'service_note is optional → complete');
      check(isCollectComplete('service_request', done), 'service_request should be complete');
      const summary = renderVerifySummary('service_request', done);
      check(summary.includes('permohonan'), 'summary must use the permohonan title');
      const mutation = buildPendingMutation('service_request', done);
      check(mutation !== null && mutation.tool === 'create_service_request',
        `expected create_service_request, got ${mutation?.tool}`);
      check(mutation!.args.service_slug === 'surat keterangan domisili',
        `service_slug mismatch: '${mutation!.args.service_slug}'`);
    },
  },
  {
    id: 'EVAL-M03',
    category: 'multi-turn',
    input: 'rusak',
    expect: 'too-short description → validation error, collect NOT complete (re-ask)',
    description: 'Slot validation rejects a 5-char description; pipeline must re-ask, never guess',
    run: async () => {
      const slots: Slots = {
        [INTENT_SLOT_KEY]: 'complaint',
        category: 'jalan rusak',
        location: 'RT 02/RW 04',
      };
      const m = mergeSlots('complaint', slots, { description: 'rusak' });
      check(m.errors.length === 1 && m.errors[0].slot === 'description',
        `expected one description error, got ${JSON.stringify(m.errors)}`);
      check(m.errors[0].error.length > 0, 'error must be a citizen-readable message');
      check(!isCollectComplete('complaint', m.slots), 'collect must stay incomplete');
      const missing = nextMissingSlot('complaint', m.slots);
      check(missing?.name === 'description', 'still waiting on description');
    },
  },
  {
    id: 'EVAL-M04',
    category: 'multi-turn',
    input: '(VERIFY lane) warga: "Sudah benar semua"',
    expect: 'VERIFY lane mints pendingTool, shows deterministic summary, calls NO LLM and NO tools',
    description: 'Deterministic VERIFY lane: summary + pending mutation without any LLM/tool call',
    run: async () => {
      const slots: Slots = {
        [INTENT_SLOT_KEY]: 'complaint',
        category: 'penerangan jalan',
        description: 'Sudah seminggu mati, warga takut keluar malam',
        location: 'jalan mati di depan balai desa RT 01/RW 02',
      };
      const turn = await runStagedTurn(stagedInput('Sudah benar semua', 'VERIFY', slots));
      check(turn.terminalState === 'SUCCEEDED', `terminalState = ${turn.terminalState}`);
      check(turn.intent === 'verify', `intent = ${turn.intent}`);
      check(turn.toolsUsed.length === 0, `no tools may run in VERIFY lane, got ${turn.toolsUsed}`);
      check(turn.response.includes('Mohon periksa kembali laporan Anda'),
        'VERIFY lane must show the deterministic summary');
      check(turn.response.includes('penerangan jalan'), 'summary must contain recorded slots');
      check(mockCallLlm().mock.calls.length === 0, 'VERIFY lane must not call the LLM');
    },
  },
  {
    id: 'EVAL-M05',
    category: 'multi-turn',
    input: '(VERIFY lane) warga: "ada yang salah, lokasinya keliru"',
    expect: 'no extractable fix → correction_applied, stays VERIFY, summary re-shown, pendingTool minted',
    description: 'Correction turn in VERIFY without extractable values: re-show summary, keep mutation pending',
    run: async () => {
      const slots: Slots = {
        [INTENT_SLOT_KEY]: 'complaint',
        category: 'penerangan jalan',
        description: 'Sudah seminggu mati, warga takut keluar malam',
        location: 'jalan mati di depan balai desa RT 01/RW 02',
      };
      const input = stagedInput('ada yang salah, lokasinya keliru', 'VERIFY', slots);
      const turn = await runStagedTurn(input);
      check(turn.terminalState === 'SUCCEEDED', `terminalState = ${turn.terminalState}`);
      // The message carries no extractable slot values, so the deterministic
      // correction is a no-op: slots stay complete → the pending mutation is
      // minted, the summary is re-shown, and the turn stays in VERIFY.
      // Nothing is executed, dropped, or sent to the LLM.
      check(turn.intent === 'correction_applied', `intent = ${turn.intent}`);
      check(turn.stage === 'VERIFY', `stage = ${turn.stage}`);
      check(turn.response.includes('Mohon periksa kembali laporan Anda'),
        `summary must be re-shown, got: '${turn.response.slice(0, 80)}'`);
      check(turn.toolsUsed.length === 0, 'no tools may run on a correction turn');
      const pending = (input.ctx.slots as Record<string, unknown>).pendingTool;
      check(pending !== undefined && pending !== null,
        'pendingTool must be minted so the next confirm_send can bind');
      check(mockCallLlm().mock.calls.length === 0, 'correction lane must not call the LLM');
    },
  },
];
