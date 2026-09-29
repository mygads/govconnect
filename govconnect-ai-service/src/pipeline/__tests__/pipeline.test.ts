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

  it('never leaks raw NIK into dynamic context', () => {
    const { dynamicContext } = buildPrompt({
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

  it('tokenizes NIK on inbound and detokenizes deterministically', () => {
    const { text, tokens } = piiInbound(`NIK saya ${NIK} tolong cek`);
    expect(text).not.toContain(NIK);
    expect(detokenize(text, tokens)).toContain(NIK);
  });

  it('redacts phone numbers on inbound', () => {
    const { text } = piiInbound('hubungi 081234567890 ya');
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
