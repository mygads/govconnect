import { describe, it, expect } from 'vitest';
import { __test_only__ as preAgentTestOnly, tryHandleOutOfScopeGuard } from '../pre-agent-state-router.service';
import { __test_only__ as agentOrchestratorTestOnly } from '../agent/agent-orchestrator';

const {
  isPendingServiceFollowUp,
  isPendingServiceLinkRequest,
  isClearlyDifferentIntent,
  detectExplicitConfirmationReply,
} = preAgentTestOnly;

const { selectAllowedTools } = agentOrchestratorTestOnly;

describe('pre-agent scope guard', () => {
  it('redirects clear general out-of-scope questions', () => {
    const result = tryHandleOutOfScopeGuard({
      message: '1+1 = berapa?',
      traceId: 'test-trace',
      startTime: Date.now(),
    });

    expect(result).not.toBeNull();
    expect(result?.response).toContain('fokus membantu layanan desa dan penggunaan GovConnect');
    expect(result?.intent).toBe('QUESTION');
  });

  it('does not block GovConnect usage questions', () => {
    const result = tryHandleOutOfScopeGuard({
      message: 'bagaimana cara cek status di GovConnect?',
      traceId: 'test-trace',
      startTime: Date.now(),
    });

    expect(result).toBeNull();
  });

  it('redirects known non-village public service questions', () => {
    const result = tryHandleOutOfScopeGuard({
      message: 'cara urus paspor bagaimana?',
      traceId: 'test-trace',
      startTime: Date.now(),
    });

    expect(result).not.toBeNull();
    expect(result?.response).toContain('belum tersedia di sistem desa kami');
  });
});

describe('pending service follow-up helpers', () => {
  it('detects informational service follow-up utterances', () => {
    expect(isPendingServiceFollowUp('berapa lama?')).toBe(true);
    expect(isPendingServiceFollowUp('harus ke kantor?')).toBe(true);
    expect(isPendingServiceFollowUp('syaratnya apa?')).toBe(true);
  });

  it('detects direct link requests separately from generic follow-up', () => {
    expect(isPendingServiceLinkRequest('ada link?')).toBe(true);
    expect(isPendingServiceLinkRequest('formnya mana?')).toBe(true);
    expect(isPendingServiceLinkRequest('berapa lama prosesnya?')).toBe(false);
  });

  it('keeps neutral service follow-up in the same thread', () => {
    expect(isClearlyDifferentIntent('berapa lama?')).toBe(false);
    expect(isClearlyDifferentIntent('harus ke kantor?')).toBe(false);
    expect(isClearlyDifferentIntent('syaratnya apa?')).toBe(false);
  });

  it('marks explicit thread switches as different intent', () => {
    expect(isClearlyDifferentIntent('mau lapor jalan rusak')).toBe(true);
    expect(isClearlyDifferentIntent('cek status LAY-20260509-001')).toBe(true);
    expect(isClearlyDifferentIntent('batalkan layanan saya')).toBe(true);
  });

  it('keeps explicit confirmation parsing stable', () => {
    expect(detectExplicitConfirmationReply('iya')).toBe('yes');
    expect(detectExplicitConfirmationReply('gak jadi')).toBe('no');
    expect(detectExplicitConfirmationReply('berapa lama?')).toBe('uncertain');
  });
});

describe('agent tool routing with active service context', () => {
  it('allows service tools for short follow-up when active service context exists', async () => {
    const result = await selectAllowedTools('berapa lama?', {
      activeServiceSlug: 'administrasi-kependudukan-surat-pengantar-ktp',
      activeServiceName: 'Surat Pengantar KTP',
    });

    expect(result.allowedToolNames).toContain('get_service_info');
    expect(result.allowedToolNames).toContain('create_service_request');
  });

  it('allows service tools for office-visit follow-up when active service context exists', async () => {
    const result = await selectAllowedTools('harus ke kantor?', {
      activeServiceSlug: 'administrasi-kependudukan-surat-pengantar-ktp',
      activeServiceName: 'Surat Pengantar KTP',
    });

    expect(result.allowedToolNames).toContain('get_service_info');
    expect(result.allowedToolNames).toContain('create_service_request');
  });

  it('does not force service follow-up routing without active service context', async () => {
    const result = await selectAllowedTools('berapa lama?', {});

    expect(result.allowedToolNames).not.toContain('create_service_request');
  });
});
