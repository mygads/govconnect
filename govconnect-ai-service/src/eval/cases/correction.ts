/**
 * EVAL correction — user fixes, cancels, or re-confirms.
 *
 * Covers: mid-collect correction detection + slot replacement, typed
 * cancellation (deterministic CLOSE lane), and the full confirmation-chain
 * contract (P0-1):
 *   - confirm_send button + bound pending mutation → execute,
 *   - typed "Ya" on WhatsApp NEVER executes — re-shows VERIFY,
 *   - edit_data / cancel_request → deterministic edit/cancel copies,
 *   - stale click (no pending mutation) → rejected with stale copy.
 */
import {
  bindConfirmation,
  resolveConfirmation,
  CONFIRM_CANCEL_COPY,
  CONFIRM_EDIT_COPY,
  STALE_CONFIRMATION_COPY,
  type PendingMutation,
} from '../../pipeline/confirmation';
import {
  INTENT_SLOT_KEY,
  buildPendingMutation,
  extractSlotsDeterministic,
  isCancellation,
  isCorrectionRequest,
  isExplicitConfirmation,
  mergeSlots,
  type Slots,
} from '../../pipeline/slot-fsm';
import { runStagedTurn, type StagedAgentInput } from '../../pipeline/staged-agent';
import { check, evalContext, mockCallLlm, mockGatewayExecute } from '../support';
import type { EvalCase } from '../types';

function complaintSlots(): Slots {
  return {
    [INTENT_SLOT_KEY]: 'complaint',
    category: 'jalan rusak',
    description: 'Jalan berlubang parah di depan rumah sejak sebulan lalu',
    location: 'RT 01/RW 02',
  };
}

export const cases: EvalCase[] = [
  {
    id: 'EVAL-C01',
    category: 'correction',
    input: 'eh salah, maksudku lampu jalannya yang mati',
    expect: 'correction detected; category slot replaced with penerangan jalan',
    description: 'Mid-collect self-correction: "salah" detected, category re-extracted and replaced',
    run: async () => {
      const msg = 'eh salah, maksudku lampu jalannya yang mati';
      check(isCorrectionRequest(msg) === true, 'must be detected as a correction request');
      const slots = complaintSlots();
      const ext = extractSlotsDeterministic(msg, 'complaint');
      check(ext.category === 'penerangan jalan',
        `re-extraction must yield 'penerangan jalan', got '${ext.category}'`);
      const merged = mergeSlots('complaint', slots, ext);
      check(merged.slots.category === 'penerangan jalan',
        `category must be replaced, got '${merged.slots.category}'`);
      // Unrelated slots survive the correction.
      check(merged.slots.location === 'RT 01/RW 02', 'location must survive the correction');
    },
  },
  {
    id: 'EVAL-C02',
    category: 'correction',
    input: 'yaudah gak jadi aja deh',
    expect: 'terminalState=CANCELLED; no tool executed; no LLM called',
    description: 'Typed cancellation anywhere → deterministic CLOSE lane, zero side effects',
    run: async () => {
      const msg = 'yaudah gak jadi aja deh';
      check(isCancellation(msg) === true, 'must be detected as cancellation');
      const ctx = evalContext('eval-c02');
      const input: StagedAgentInput = {
        message: msg,
        decision: { stage: 'COLLECT', source: 'deterministic', confidence: 1, reasons: [] },
        ctx,
        villageName: 'Desa',
      };
      const turn = await runStagedTurn(input);
      check(turn.terminalState === 'CANCELLED', `terminalState = ${turn.terminalState}`);
      check(turn.stage === 'CLOSE', `stage = ${turn.stage}`);
      check(turn.response.includes('dibatalkan'), 'reply must confirm the cancellation');
      check(turn.toolsUsed.length === 0, 'cancellation must execute no tools');
      check(mockGatewayExecute().mock.calls.length === 0, 'gateway must not be touched');
      check(mockCallLlm().mock.calls.length === 0, 'LLM must not be called');
    },
  },
  {
    id: 'EVAL-K01',
    category: 'correction',
    input: 'tombol confirm_send vs ketikan "Ya, lanjutkan"',
    expect: 'button+pending → execute; typed "Ya" (WA) → reverify, never executes',
    description: 'P0-1 contract: only a bound button.id authorizes execution on WhatsApp',
    run: async () => {
      const mutation = buildPendingMutation('complaint', complaintSlots()) as PendingMutation;
      check(mutation !== null, 'test fixture must build a pending mutation');

      // Button path: bind + resolve → execute.
      const slots = { pendingTool: mutation };
      check(bindConfirmation('confirm_send', slots) === true, 'confirm_send must bind with pendingTool');
      const exec = resolveConfirmation({
        buttonId: 'confirm_send', confirmed: true, message: '', pending: mutation,
      });
      check(exec.kind === 'execute', `button path must resolve to execute, got ${exec.kind}`);

      // Typed affirmation on WhatsApp: detected as affirmative intent…
      check(isExplicitConfirmation('Ya, lanjutkan') === true, '"Ya, lanjutkan" is affirmative');
      // …but NEVER executes without a button binding.
      check(bindConfirmation('Ya, lanjutkan', slots) === false, 'text must never bind a confirmation');
      const reverify = resolveConfirmation({
        buttonId: null, confirmed: false, message: 'Ya, lanjutkan', pending: mutation,
        channel: 'whatsapp',
      });
      check(reverify.kind === 'reverify',
        `typed "Ya" on WA must re-show VERIFY, got ${reverify.kind}`);
    },
  },
  {
    id: 'EVAL-K02',
    category: 'correction',
    input: 'tombol edit_data / cancel_request',
    expect: 'edit → edit copy; cancel → cancel copy',
    description: 'Edit/cancel buttons resolve to deterministic correction/cancellation copies',
    run: async () => {
      const mutation = buildPendingMutation('complaint', complaintSlots()) as PendingMutation;
      const edit = resolveConfirmation({ buttonId: 'edit_data', pending: mutation, message: '' });
      check(edit.kind === 'edit', `edit_data must resolve to edit, got ${edit.kind}`);
      check(CONFIRM_EDIT_COPY.includes('diperbaiki'), 'edit copy must ask what to fix');
      const cancel = resolveConfirmation({ buttonId: 'cancel_request', pending: mutation, message: '' });
      check(cancel.kind === 'cancel', `cancel_request must resolve to cancel, got ${cancel.kind}`);
      check(CONFIRM_CANCEL_COPY.includes('dibatalkan'), 'cancel copy must confirm cancellation');
    },
  },
  {
    id: 'EVAL-K03',
    category: 'correction',
    input: 'klik confirm_send basi (tanpa pending mutation)',
    expect: 'stale → rejected with STALE_CONFIRMATION_COPY, never executes',
    description: 'Stale/replayed confirm click without pending mutation is rejected deterministically',
    run: async () => {
      check(bindConfirmation('confirm_send', {}) === false,
        'confirm_send must not bind without a pendingTool');
      const stale = resolveConfirmation({
        buttonId: 'confirm_send', confirmed: false, message: '', pending: null,
      });
      check(stale.kind === 'stale', `must resolve to stale, got ${stale.kind}`);
      check(STALE_CONFIRMATION_COPY.includes('tidak berlaku'),
        'stale copy must explain the session expired');
    },
  },
];
