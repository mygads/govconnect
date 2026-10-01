/**
 * EVAL live-LLM cases — SKIPPED by default.
 *
 * These scenarios are genuinely beyond the deterministic machinery: they
 * need a real model's judgment (long-range anaphora, multi-intent
 * splitting). They are registered here so the harness DOCUMENTS the known
 * coverage gap instead of pretending it doesn't exist.
 *
 * To run them: set EVAL_LIVE_LLM=1 — the runner will then attempt a live
 * call through the configured provider and mark them accordingly. Until
 * then they report as SKIP with an explicit reason.
 */
import { check } from '../support';
import type { EvalCase } from '../types';

const LIVE_HINT =
  'needs live LLM judgment — deterministic machinery has no signal; skipped by default';

export const cases: EvalCase[] = [
  {
    id: 'EVAL-L01',
    category: 'live-llm',
    input: 'yang itu lho, yang kemarin saya bilang',
    expect: 'assessor resolves the anaphora against conversation history',
    description: 'Long-range anaphora ("yang itu… yang kemarin") — needs real LLM context resolution',
    liveLLM: true,
    skipReason: LIVE_HINT,
    run: async () => {
      if (process.env.EVAL_LIVE_LLM !== '1') {
        throw new Error('EVAL-L01 requires EVAL_LIVE_LLM=1 (live provider call)');
      }
      check(false, 'live-LLM execution not implemented in this harness revision');
    },
  },
  {
    id: 'EVAL-L02',
    category: 'live-llm',
    input: 'sekalian lapor jalan rusak terus cek status laporan kemarin',
    expect: 'multi-intent split into create_complaint + check_status in one turn',
    description: 'Multi-intent split (report + status check) — needs real LLM planning',
    liveLLM: true,
    skipReason: LIVE_HINT,
    run: async () => {
      if (process.env.EVAL_LIVE_LLM !== '1') {
        throw new Error('EVAL-L02 requires EVAL_LIVE_LLM=1 (live provider call)');
      }
      check(false, 'live-LLM execution not implemented in this harness revision');
    },
  },
];
