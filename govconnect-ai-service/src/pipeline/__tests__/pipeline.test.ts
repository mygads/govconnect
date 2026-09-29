/**
 * Unit tests for the v2 staged-agent pipeline skeleton.
 * Pure/deterministic modules only — no LLM, no DB, no network.
 */

import { describe, it, expect } from 'vitest';
import { routeMessage } from '../stage-router';
import { assessStage, shouldSuggestHandoff } from '../stage-assessor';
import { transitionsFrom, isAllowedTransition, DETERMINISTIC_ONLY_STAGES } from '../stage-graph';
import { buildStaticSystemPrompt, buildPrompt } from '../prompt-builder';
import { buildFallback, mintTempTicket, assertNonEmptyResponse } from '../fallback-policy';
import { piiInbound, piiOutbound, detokenize, redactForLog } from '../../gateway/pii-gateway';
import { STAGE_TOOL_ALLOWLIST, TOOL_GRADES, isParallelizable } from '../../gateway/tool-policy';
import { getPipelineMode } from '../feature-flags';
import {
  classifySlotIntent, extractSlotsDeterministic, mergeSlots, nextMissingSlot,
  isCollectComplete, renderVerifySummary, isExplicitConfirmation, isCancellation,
  isCorrectionRequest, buildPendingMutation, type Slots,
} from '../slot-fsm';

describe('stage-router (deterministic)', () => {
  it('routes emergency keywords to EMERGENCY deterministically', () => {
    const d = routeMessage({ message: 'Tolong! Ada kebakaran di RT 3!' });
    expect(d.stage).toBe('EMERGENCY');
    expect(d.source).toBe('deterministic');
    expect(d.confidence).toBe(1);
  });

  it('routes greetings without LLM', () => {
    const d = routeMessage({ message: 'halo' });
    expect(d.stage).toBe('INFORMATION');
    expect(d.hints?.greeting).toBe(true);
  });

  it('routes explicit status patterns to STATUS_CHECK', () => {
    const d = routeMessage({ message: 'cek status laporan saya dong' });
    expect(d.stage).toBe('STATUS_CHECK');
  });

  it('sends ambiguous messages to TRIAGE for the assessor', () => {
    const d = routeMessage({ message: 'saya mau tanya soal sesuatu yang penting kemarin itu' });
    expect(d.stage).toBe('TRIAGE');
    expect(d.hints?.needsAssessor).toBe(true);
  });

  it('handles empty messages safely', () => {
    const d = routeMessage({ message: '   ' });
    expect(d.stage).toBe('TRIAGE');
  });
});

describe('stage-assessor', () => {
  it('judges fuzzy transitions from TRIAGE', async () => {
    const d = await assessStage({ message: 'jalan di depan rumah saya rusak parah', fromStage: 'TRIAGE' });
    expect(d.stage).toBe('COLLECT');
  });

  it('returns no-signal clarification when nothing matches', async () => {
    const d = await assessStage({ message: 'hmm ya gitu deh', fromStage: 'TRIAGE' });
    expect(d.hints?.needsClarification).toBe(true);
    expect(d.confidence).toBeLessThan(0.4);
  });

  it('suggests handoff after two low-confidence assessments', () => {
    expect(shouldSuggestHandoff([0.3, 0.35])).toBe(true);
    expect(shouldSuggestHandoff([0.3, 0.8])).toBe(false);
    expect(shouldSuggestHandoff([0.3])).toBe(false);
  });
});

describe('stage-graph', () => {
  it('declares deterministic-only stages', () => {
    expect(DETERMINISTIC_ONLY_STAGES.has('EMERGENCY')).toBe(true);
    expect(DETERMINISTIC_ONLY_STAGES.has('TRIAGE')).toBe(false);
  });

  it('validates transitions', () => {
    expect(isAllowedTransition('COLLECT', 'VERIFY')).toBe(true);
    expect(isAllowedTransition('INGRESS', 'EXECUTE')).toBe(false);
  });

  it('TRIAGE has fuzzy transitions for the assessor', () => {
    const fuzzy = transitionsFrom('TRIAGE').filter((t) => t.kind === 'fuzzy');
    expect(fuzzy.length).toBeGreaterThan(0);
  });
});

describe('prompt-builder', () => {
  it('keeps the static system prompt byte-identical', () => {
    expect(buildStaticSystemPrompt()).toBe(buildStaticSystemPrompt());
  });

  it('never leaks raw NIK into dynamic context', async () => {
    const { dynamicContext } = await buildPrompt({
      villageName: 'Desa X',
      stage: 'INFORMATION',
      facts: ['NIK warga: 3201010101010001'],
      records: [],
    });
    expect(dynamicContext).not.toContain('3201010101010001');
    expect(dynamicContext).toContain('⟦NIK_');
  });
});

describe('fallback-policy (never-silent)', () => {
  it('always produces a non-empty degraded response with ticket ref', () => {
    const fb = buildFallback({
      stage: 'COLLECT', terminalState: 'FAILED',
      userId: 'u1', traceId: 't1', intentHint: 'complaint',
    });
    expect(fb.response.trim().length).toBeGreaterThan(0);
    expect(fb.ticketRef).toMatch(/^TMP-/);
    expect(fb.response).toContain(fb.ticketRef);
  });

  it('mints unique ticket refs', () => {
    expect(mintTempTicket()).not.toBe(mintTempTicket());
  });

  it('crashes loudly on empty responses in dev', () => {
    expect(() => assertNonEmptyResponse('   ', 'test')).toThrow();
    expect(() => assertNonEmptyResponse('ok', 'test')).not.toThrow();
  });
});

describe('pii-gateway', () => {
  const NIK = '3201010101010001';

  it('tokenizes NIK on inbound and detokenizes deterministically', async () => {
    const { text, tokens } = await piiInbound(`NIK saya ${NIK} tolong cek`, 'test-tenant');
    expect(text).not.toContain(NIK);
    expect(detokenize(text, tokens)).toContain(NIK);
  });

  it('redacts phone numbers on inbound', async () => {
    const { text } = await piiInbound('hubungi 081234567890 ya', 'test-tenant');
    expect(text).not.toContain('081234567890');
  });

  it('detects PII leaks on outbound', () => {
    const { leaked, text } = piiOutbound(`data ${NIK} bocor`);
    expect(leaked).toBe(true);
    expect(text).not.toContain(NIK);
    expect(piiOutbound('jawaban normal').leaked).toBe(false);
  });

  it('redacts for logs', () => {
    expect(redactForLog(`nik ${NIK}`)).not.toContain(NIK);
  });
});

describe('tool-gateway policy tables', () => {
  it('grades mutations as G2/G3', () => {
    expect(TOOL_GRADES.create_complaint).toBe('G2');
    expect(TOOL_GRADES.cancel_request).toBe('G3');
    expect(TOOL_GRADES.get_village_profile).toBe('G0');
  });

  it('restricts mutations to EXECUTE stage', () => {
    expect(STAGE_TOOL_ALLOWLIST.EXECUTE.has('create_complaint')).toBe(true);
    expect(STAGE_TOOL_ALLOWLIST.TRIAGE.has('create_complaint')).toBe(false);
    expect(STAGE_TOOL_ALLOWLIST.INFORMATION.has('create_complaint')).toBe(false);
  });

  it('marks only G0 tools parallelizable', () => {
    expect(isParallelizable('search_knowledge')).toBe(true);
    expect(isParallelizable('create_complaint')).toBe(false);
  });
});

describe('feature-flags', () => {
  it('defaults to off (zero behavior change)', () => {
    delete process.env.PIPELINE_MODE;
    delete process.env.PIPELINE_TENANT_OVERRIDES;
    expect(getPipelineMode('any-tenant')).toBe('off');
  });
});

describe('slot-fsm', () => {
  it('classifies complaint vs service intent deterministically', () => {
    expect(classifySlotIntent('jalan rusak berlubang di RT 01')).toBe('complaint');
    expect(classifySlotIntent('mau urus surat KTP')).toBe('service_request');
    expect(classifySlotIntent('halo selamat pagi')).toBeNull();
  });

  it('extracts category and RT/RW deterministically', () => {
    const slots = extractSlotsDeterministic('Jalan rusak parah di RT 02/RW 05', 'complaint');
    expect(slots.category).toBe('jalan rusak');
    expect(slots.location).toMatch(/RT 02\/RW 05/i);
  });

  it('detects the next missing slot and completion', () => {
    expect(nextMissingSlot('complaint', {} as Slots)?.name).toBe('category');
    const full: Slots = { category: 'sampah', description: 'sampah menumpuk sejak seminggu', location: 'RT 01' };
    expect(isCollectComplete('complaint', full)).toBe(true);
    expect(nextMissingSlot('complaint', full)).toBeNull();
  });

  it('rejects invalid slot values with a user-facing error', () => {
    const { slots, errors } = mergeSlots('complaint', {}, { description: 'ok' });
    expect(slots.description).toBeUndefined();
    expect(errors[0].error).toMatch(/terlalu singkat/);
  });

  it('renders a deterministic verify summary without LLM', () => {
    const s = renderVerifySummary('complaint', { category: 'sampah', description: 'menumpuk', location: 'RT 01' } as Slots);
    expect(s).toContain('sampah');
    expect(s).toContain('Ya, lanjutkan');
  });

  it('detects explicit confirmation, cancellation, correction', () => {
    expect(isExplicitConfirmation('Ya, lanjutkan')).toBe(true);
    expect(isExplicitConfirmation('ya')).toBe(true);
    expect(isExplicitConfirmation('belum, tunggu')).toBe(false);
    expect(isCancellation('batal saja')).toBe(true);
    expect(isCorrectionRequest('salah, ubah lokasinya')).toBe(true);
  });

  it('plans a deterministic complaint mutation', () => {
    const m = buildPendingMutation('complaint', {
      category: 'jalan rusak', description: 'jalan berlubang dalam', location: 'RT 02/RW 05',
    } as Slots);
    expect(m?.tool).toBe('create_complaint');
    expect(m?.args.deskripsi).toBe('jalan berlubang dalam');
    expect(m?.args.rt_rw).toMatch(/RT 02\/RW 05/);
  });

  it('refuses to plan a mutation when required data is missing', () => {
    expect(buildPendingMutation('complaint', {} as Slots)).toBeNull();
    expect(buildPendingMutation('service_request', {} as Slots)).toBeNull();
  });
});
