/**
 * EVAL fallback — graceful degradation when the pipeline cannot proceed.
 *
 * Covers: ticket issuance without persistence (DB down), assessor LLM
 * failure → deterministic fallback, and the regional-language fallback
 * detector (Javanese) — all deterministic.
 */
import { issueFallback, mintTempTicket } from '../../pipeline/fallback-policy';
import { assessStage, setAssessorLLM } from '../../pipeline/stage-assessor';
import { detectLanguage, shouldUseRegionalFallback } from '../../pipeline/language-fallback';
import { check } from '../support';
import type { EvalCase } from '../types';

export const cases: EvalCase[] = [
  {
    id: 'EVAL-F01',
    category: 'fallback',
    input: '(turn gagal total, DB down)',
    expect: 'TMP- ref minted, persisted=false, response contains the ref, never empty',
    description: 'Fallback without persistence: real temp ticket ref, honest unpersisted copy',
    run: async () => {
      const { response, ticketRef, persisted } = await issueFallback(
        {
          stage: 'COLLECT',
          terminalState: 'FAILED',
          userId: 'eval-user',
          traceId: 'eval-f01',
          tenantId: 'eval-village',
          channel: 'whatsapp',
          intentHint: 'complaint',
        },
        { persist: false },
      );
      check(/^TMP-\d{8}-[0-9A-F]{6}$/.test(ticketRef),
        `ticketRef must match TMP-YYYYMMDD-XXXXXX, got '${ticketRef}'`);
      check(persisted === false, 'must report persisted=false when the DB is down');
      check(response.length > 0, 'fallback response must never be empty');
      check(response.includes(ticketRef),
        'the "reference is REAL" invariant: the response must contain the issued ref');
      check(response.includes('BELUM tersimpan'),
        'honesty rule: unpersisted fallback must say the report is NOT saved yet');
      // mintTempTicket itself: uniqueness sanity.
      const a = mintTempTicket();
      const b = mintTempTicket();
      check(a !== b, 'minted ticket refs must be unique');
    },
  },
  {
    id: 'EVAL-F02',
    category: 'fallback',
    input: 'lampu jalan mati (assessor LLM mati)',
    expect: 'assessor LLM throws → deterministic fallback still returns COLLECT',
    description: 'Assessor resilience: LLM outage degrades to keyword fallback, never throws',
    run: async () => {
      setAssessorLLM(async () => {
        throw new Error('eval-simulated llm outage');
      });
      try {
        const decision = await assessStage({ message: 'lampu jalan mati', fromStage: 'TRIAGE' });
        check(decision.stage === 'COLLECT',
          `deterministic fallback should pick COLLECT, got ${decision.stage}`);
        check(decision.source === 'deterministic',
          `source must be deterministic on LLM failure, got ${decision.source}`);
      } finally {
        // Reset the hook so other cases/files are unaffected.
        setAssessorLLM(null as unknown as Parameters<typeof setAssessorLLM>[0]);
      }
    },
  },
  {
    id: 'EVAL-F03',
    category: 'fallback',
    input: 'aku ora ngerti carane ngurus KTP neng kene',
    expect: 'language=jv, regional fallback enabled',
    description: 'Javanese dialect detected → regional-language fallback copy path',
    run: async () => {
      const msg = 'aku ora ngerti carane ngurus KTP neng kene';
      const det = detectLanguage(msg);
      check(det.language === 'jv', `expected jv, got '${det.language}'`);
      check(det.markerHits >= 2, `expected ≥2 javanese markers, got ${det.markerHits}`);
      check(shouldUseRegionalFallback(det) === true,
        'regional fallback must be enabled for confident javanese');
      // Control: plain Indonesian must NOT trigger the regional path.
      const id = detectLanguage('saya tidak mengerti cara mengurus KTP di sini');
      check(shouldUseRegionalFallback(id) === false,
        `plain Indonesian must not trigger regional fallback, got ${id.language}`);
    },
  },
];
