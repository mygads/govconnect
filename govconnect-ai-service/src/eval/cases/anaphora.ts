/**
 * EVAL anaphora — pronoun/topic references resolved against conversation state.
 *
 * The deterministic assessor carries two fail-safe guards (no LLM):
 *  - P1-11: a question during VERIFY with a minted pending mutation stays
 *    in VERIFY — the mutation is never executed nor dropped implicitly.
 *  - active COLLECT protection: weak keyword drift (score ≤ 3) must not
 *    yank the conversation out of an incomplete collection; explicit
 *    frustration (HANDOFF) is still allowed through as a safety valve.
 */
import { assessStage } from '../../pipeline/stage-assessor';
import { extractSlotsDeterministic } from '../../pipeline/slot-fsm';
import { check } from '../support';
import type { EvalCase } from '../types';

export const cases: EvalCase[] = [
  {
    id: 'EVAL-A01',
    category: 'anaphora',
    input: 'kapan kira-kira selesainya? (di VERIFY, mutasi pending)',
    expect: 'stays VERIFY via assessor_verify_pending_protected',
    description: 'Anaphoric "selesainya" during VERIFY: keep the pending mutation, never drop/execute',
    run: async () => {
      const decision = await assessStage({
        message: 'kapan kira-kira selesainya?',
        fromStage: 'VERIFY',
        verifyPending: true,
      });
      check(decision.stage === 'VERIFY',
        `must stay in VERIFY, got ${decision.stage}`);
      check(decision.reasons.includes('assessor_verify_pending_protected'),
        `wrong guard reason: ${JSON.stringify(decision.reasons)}`);
      check(decision.source === 'deterministic', `source = ${decision.source}`);
    },
  },
  {
    id: 'EVAL-A02',
    category: 'anaphora',
    input: 'oh iya, sekalian tanya jadwal posyandu bulan ini (COLLECT aktif)',
    expect: 'stays COLLECT via no_fuzzy_transitions (stage-graph owns COLLECT exits)',
    description: 'Weak topic drift during active complaint COLLECT must not abandon slot collection',
    run: async () => {
      const decision = await assessStage({
        message: 'oh iya, sekalian tanya jadwal posyandu bulan ini',
        fromStage: 'COLLECT',
        activeCollectIntent: 'complaint',
      });
      check(decision.stage === 'COLLECT',
        `must stay in COLLECT, got ${decision.stage}`);
      // Mechanism (pinned, 2026-10-01): the stage-graph defines NO fuzzy
      // transitions out of COLLECT — COLLECT exits are deterministic only
      // (→VERIFY when complete, →COLLECT re-ask, →HANDOFF after 2 failures).
      // The assessor's active-collect protection is defense-in-depth for
      // graphs that do expose fuzzy COLLECT exits.
      check(decision.reasons.includes('no_fuzzy_transitions'),
        `wrong mechanism: ${JSON.stringify(decision.reasons)}`);
      check(decision.source === 'deterministic', `source = ${decision.source}`);
    },
  },
  {
    id: 'EVAL-A03',
    category: 'anaphora',
    input: 'itu lho lokasinya, yang tadi saya bilang (COLLECT aktif)',
    expect: 'stays COLLECT; location fragment still extractable',
    description: 'Anaphoric location repair stays in COLLECT and updates the location slot',
    run: async () => {
      const decision = await assessStage({
        message: 'itu lho lokasinya, yang tadi saya bilang di depan masjid RT 05',
        fromStage: 'COLLECT',
        activeCollectIntent: 'complaint',
      });
      check(decision.stage === 'COLLECT', `must stay in COLLECT, got ${decision.stage}`);
      // The repair carries fresh slot content — extraction must still work.
      const slots = extractSlotsDeterministic(
        'itu lho lokasinya, yang tadi saya bilang di depan masjid RT 05',
        'complaint',
      );
      check(!!slots.location && slots.location.includes('RT 05'),
        `location repair not extracted: '${slots.location}'`);
    },
  },
];
