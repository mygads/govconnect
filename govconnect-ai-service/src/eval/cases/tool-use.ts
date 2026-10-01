/**
 * EVAL tool use — staged agent with a SCRIPTED LLM (no real calls).
 *
 * The mock returns canned tool_calls / final text so the harness pins the
 * orchestration contract deterministically:
 *  - the scripted tool call is executed through the gateway mock,
 *  - toolsUsed records what ran,
 *  - the citizen reply carries the tool's suggested_response and NEVER
 *    raw JSON (P0-3),
 *  - EXECUTE runs only on a bound confirmation, exactly once.
 */
import { runStagedTurn, type StagedAgentInput } from '../../pipeline/staged-agent';
import type { StageDecision } from '../../pipeline/stage-types';
import {
  check, evalContext, llmTextResult, llmToolResult, mockCallLlm, mockGatewayExecute, toolOk,
} from '../support';
import type { EvalCase } from '../types';

function infoDecision(): StageDecision {
  return { stage: 'INFORMATION', source: 'assessor', confidence: 0.9, reasons: ['eval-scripted'] };
}

export const cases: EvalCase[] = [
  {
    id: 'EVAL-T01',
    category: 'tool-use',
    input: 'syarat bikin KTP apa aja ya?',
    expect: 'toolsUsed=[get_service_info]; reply contains the answer, no raw JSON leak',
    description: 'Single read tool: scripted LLM calls get_service_info, reply is citizen-facing',
    run: async () => {
      const ctx = evalContext('eval-t01');
      mockCallLlm()
        .mockResolvedValueOnce(llmToolResult([{ name: 'get_service_info', args: { service: 'KTP' } }]))
        .mockResolvedValueOnce(llmTextResult('Syarat pembuatan KTP: e-KTP lama/rusak, KK, dan surat pengantar RT/RW.'));
      mockGatewayExecute().mockImplementation(async (tool) =>
        toolOk(String(tool), 'Syarat pembuatan KTP: e-KTP lama/rusak, KK, dan surat pengantar RT/RW.'),
      );
      const input: StagedAgentInput = {
        message: 'syarat bikin KTP apa aja ya?',
        decision: infoDecision(),
        ctx,
        villageName: 'Desa',
      };
      const turn = await runStagedTurn(input);
      check(turn.terminalState === 'SUCCEEDED', `terminalState = ${turn.terminalState}`);
      check(turn.toolsUsed.includes('get_service_info'),
        `toolsUsed = ${JSON.stringify(turn.toolsUsed)}`);
      check(turn.response.includes('Syarat pembuatan KTP'),
        `reply must carry the tool answer, got: '${turn.response.slice(0, 120)}'`);
      check(!turn.response.includes('suggested_response'),
        'P0-3: raw tool payload must never leak into the citizen reply');
      check(!turn.response.includes('{"success"'),
        'P0-3: raw JSON must never leak into the citizen reply');
      const calls = mockGatewayExecute().mock.calls.filter((c) => c[0] === 'get_service_info');
      check(calls.length === 1, `get_service_info must run exactly once, ran ${calls.length}x`);
    },
  },
  {
    id: 'EVAL-T02',
    category: 'tool-use',
    input: 'kantor desa buka jam berapa? ada info bansos terbaru?',
    expect: 'both get_village_profile and search_knowledge run; both answers surfaced',
    description: 'Parallel read tools: profile (DB) + knowledge (RAG) in one turn',
    run: async () => {
      const ctx = evalContext('eval-t02');
      mockCallLlm()
        .mockResolvedValueOnce(llmToolResult([
          { name: 'get_village_profile', args: {} },
          { name: 'search_knowledge', args: { query: 'bansos terbaru' } },
        ]))
        .mockResolvedValueOnce(llmTextResult(
          'Kantor desa buka Senin–Jumat 08.00–14.00. Info bansos: pendaftaran tahap 2 dibuka minggu depan.',
        ));
      mockGatewayExecute().mockImplementation(async (tool) => {
        if (tool === 'get_village_profile') {
          return toolOk(String(tool), 'Kantor desa buka Senin–Jumat 08.00–14.00.');
        }
        return toolOk(String(tool), 'Pendaftaran bansos tahap 2 dibuka minggu depan.');
      });
      const input: StagedAgentInput = {
        message: 'kantor desa buka jam berapa? ada info bansos terbaru?',
        decision: infoDecision(),
        ctx,
        villageName: 'Desa',
      };
      const turn = await runStagedTurn(input);
      check(turn.terminalState === 'SUCCEEDED', `terminalState = ${turn.terminalState}`);
      check(turn.toolsUsed.includes('get_village_profile'), `missing get_village_profile: ${turn.toolsUsed}`);
      check(turn.toolsUsed.includes('search_knowledge'), `missing search_knowledge: ${turn.toolsUsed}`);
      check(turn.response.length > 0, 'reply must not be empty (never-silent)');
      check(!turn.response.includes('{"success"'), 'no raw JSON in the citizen reply');
    },
  },
  {
    id: 'EVAL-T03',
    category: 'tool-use',
    input: '(EXECUTE lane) tombol confirm_send ditekan',
    expect: 'create_complaint runs exactly once; pendingTool cleared (single-use); success copy shown',
    description: 'Deterministic EXECUTE: bound confirmation executes the mutation exactly once',
    run: async () => {
      const ctx = evalContext('eval-t03');
      ctx.slots.pendingTool = {
        tool: 'create_complaint',
        args: {
          kategori: 'jalan rusak',
          alamat: 'RT 02/RW 04',
          deskripsi: 'Jalan berlubang parah di depan rumah sejak sebulan lalu',
          rt_rw: 'RT 02/RW 04',
          nama_pelapor: null,
          no_hp: null,
        },
      };
      mockGatewayExecute().mockImplementation(async (tool) =>
        toolOk(String(tool), 'Laporan Anda sudah tercatat dengan nomor LAP-20261001-007.'),
      );
      const input: StagedAgentInput = {
        message: '✅ Benar, kirim',
        decision: { stage: 'EXECUTE', source: 'deterministic', confidence: 1, reasons: [] },
        ctx,
        villageName: 'Desa',
        confirmed: true,
      };
      const turn = await runStagedTurn(input);
      check(turn.terminalState === 'SUCCEEDED', `terminalState = ${turn.terminalState}`);
      check(turn.toolsUsed.includes('create_complaint'), `toolsUsed = ${turn.toolsUsed}`);
      const calls = mockGatewayExecute().mock.calls.filter((c) => c[0] === 'create_complaint');
      check(calls.length === 1, `mutation must run exactly once, ran ${calls.length}x`);
      check(turn.response.includes('LAP-20261001-007'),
        `reply must carry the ticket ref, got: '${turn.response.slice(0, 120)}'`);
      check(!turn.response.includes('suggested_response'), 'no raw tool payload in the reply');
      check(ctx.slots.pendingTool === undefined, 'pendingTool must be cleared after execution (single-use)');
      check(mockCallLlm().mock.calls.length === 0, 'EXECUTE lane must not call the LLM');
    },
  },
];
