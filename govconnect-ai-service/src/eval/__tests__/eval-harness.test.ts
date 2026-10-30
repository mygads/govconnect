/**
 * EVAL HARNESS — automated regression harness for the GovConnect AI pipeline.
 *
 * Run: `npm run eval` (this file only) or `npm test` (whole suite, includes this).
 *
 * Every case in src/eval/cases drives one pipeline slice with a MOCKED LLM —
 * nothing here calls a real provider. Cases that genuinely need a live model
 * are registered with liveLLM:true and reported as SKIP (never silently).
 *
 * Output: per-case PASS/FAIL/SKIP plus a summary table printed at the end.
 */
import { describe, it, expect, vi, beforeEach, afterAll } from 'vitest';

vi.mock('../../gateway/tool-gateway', () => ({ gatewayExecute: vi.fn() }));
vi.mock('../../services/ai-gateway.service', () => ({ callAIGatewayPrompt: vi.fn() }));
// Same mock set as pipeline/__tests__/confirmation-chain.test.ts: keeps the
// harness hermetic (no DB, no RabbitMQ, no real LLM).
vi.mock('../../pipeline/pipeline-store', () => ({
  appendAudit: vi.fn(async () => true),
  idempotencyCheck: vi.fn(async () => ({ hit: false })),
  idempotencyStore: vi.fn(async () => undefined),
  loadTurnState: vi.fn(async () => null),
  saveTurnState: vi.fn(async () => true),
  clearTurnState: vi.fn(async () => undefined),
  getDailyCostUsd: vi.fn(async () => null),
  createFallbackTicket: vi.fn(async () => 'inserted'),
}));
vi.mock('../../pipeline/takeover', () => ({
  isTakeoverActive: vi.fn(async () => ({ active: false })),
}));
// NOTE (2026-10-01): an earlier HEAD (c9ed95a) imported
// '../services/query-rewrite.service' from staged-agent.ts while the file was
// missing from the tree. At this base (origin/feat/arsitektur-final @ a38a499)
// the module is absent AND unimported, so no mock is needed. If a future commit
// reintroduces a dangling import, this harness will fail loudly at import time —
// that is the correct signal, not something to paper over here.

import { ALL_CASES } from '../cases';
import { EvalAssertion, llmTextResult, mockCallLlm, mockGatewayExecute } from '../support';
import type { EvalCase } from '../types';
import type { ToolCallResult } from '../../services/agent/tool-executor';

type CaseStatus = 'PASS' | 'FAIL' | 'SKIP';
interface CaseResult {
  id: string;
  category: string;
  status: CaseStatus;
  detail: string;
}
const results: CaseResult[] = [];

beforeEach(() => {
  vi.clearAllMocks();
  // Safe defaults: a case that forgets to script gets a benign answer and a
  // generic tool success — never a real call, never an exception.
  mockCallLlm().mockResolvedValue(llmTextResult('Baik, ada yang bisa saya bantu?'));
  mockGatewayExecute().mockResolvedValue({
    ok: true,
    result: { success: true, suggested_response: 'OK (eval default).' } as unknown as ToolCallResult,
    trace: { tool: 'eval-default', success: true, durationMs: 1 },
  });
});

function register(c: EvalCase) {
  if (c.liveLLM) {
    results.push({ id: c.id, category: c.category, status: 'SKIP', detail: c.skipReason ?? 'live LLM required' });
    it.skip(`${c.id} [${c.category}] ${c.description}`, () => {
      // Skipped by default — see src/eval/cases/live-llm.ts.
    });
    return;
  }
  it(`${c.id} [${c.category}] ${c.description}`, async () => {
    try {
      await c.run();
      results.push({ id: c.id, category: c.category, status: 'PASS', detail: c.expect });
    } catch (err) {
      const detail = err instanceof EvalAssertion
        ? `EXPECTATION: ${err.message}`
        : `ERROR: ${err instanceof Error ? err.message : String(err)}`;
      results.push({ id: c.id, category: c.category, status: 'FAIL', detail });
      throw err;
    }
  });
}

describe('eval harness — fresh natural test cases', () => {
  for (const c of ALL_CASES) register(c);

  it('registers at least 20 cases', () => {
    expect(ALL_CASES.length).toBeGreaterThanOrEqual(20);
  });
});

afterAll(() => {
  const pass = results.filter((r) => r.status === 'PASS').length;
  const fail = results.filter((r) => r.status === 'FAIL').length;
  const skip = results.filter((r) => r.status === 'SKIP').length;
  const line = (r: CaseResult) =>
    `${r.status.padEnd(4)} ${r.id.padEnd(10)} [${r.category}] ${r.detail}`;
  const failed = results.filter((r) => r.status === 'FAIL');
  const skipped = results.filter((r) => r.status === 'SKIP');
  console.log('\n┌─ EVAL HARNESS SUMMARY ─────────────────────────────────────');
  console.log(`│ total=${results.length}  PASS=${pass}  FAIL=${fail}  SKIP=${skip} (live-LLM, by design)`);
  for (const r of results.filter((x) => x.status === 'PASS')) console.log(`│ ${line(r)}`);
  for (const r of skipped) console.log(`│ ${line(r)}`);
  for (const r of failed) console.log(`│ ${line(r)}`);
  console.log('└────────────────────────────────────────────────────────────\n');
});
