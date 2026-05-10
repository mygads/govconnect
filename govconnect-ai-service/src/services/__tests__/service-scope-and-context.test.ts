import { describe, it, expect } from 'vitest';
import {
  __test_only__ as preAgentTestOnly,
  tryHandleActiveServiceFollowUp,
  tryHandleOutOfScopeGuard,
} from '../pre-agent-state-router.service';
import { __test_only__ as agentOrchestratorTestOnly } from '../agent/agent-orchestrator';
import {
  clearActiveServiceInfo,
  clearPendingServiceFormOffer,
  getPendingServiceFormOffer,
  setActiveServiceInfo,
} from '../ump-state';

const {
  isPendingServiceFollowUp,
  isPendingServiceLinkRequest,
  isClearlyDifferentIntent,
  detectExplicitConfirmationReply,
  buildActiveServiceFollowUpReply,
} = preAgentTestOnly;

const { selectAllowedTools, shouldStopAfterSufficientServiceInfo } = agentOrchestratorTestOnly;

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
    expect(isPendingServiceLinkRequest('bisa online kah?')).toBe(false);
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

describe('active service follow-up replies', () => {
  it('treats online availability as informational follow-up, not direct link request', () => {
    const reply = buildActiveServiceFollowUpReply({
      service_slug: 'surat-pengantar-ktp',
      service_name: 'Surat Pengantar KTP',
      village_id: 'village-1',
      mode: 'both',
      is_online: true,
      can_send_form_link: true,
      estimated_cost: 'Gratis',
      estimated_processing_time: '1 hari kerja',
      requirements: [],
      requirements_count: 0,
      suggested_response: 'fallback',
      timestamp: Date.now(),
    }, 'bisa online kah?');

    expect(reply).toContain('bisa diajukan online');
    expect(reply).not.toContain('Balas *iya*');
  });

  it('offers link via pending offer instead of auto-sending it from active service state', async () => {
    const userId = 'active-service-user';
    clearActiveServiceInfo(userId);
    clearPendingServiceFormOffer(userId);
    setActiveServiceInfo(userId, {
      service_slug: 'surat-pengantar-ktp',
      service_name: 'Surat Pengantar KTP',
      village_id: 'village-1',
      mode: 'online',
      is_online: true,
      can_send_form_link: true,
      estimated_cost: 'Gratis',
      estimated_processing_time: '1 hari kerja',
      requirements: [],
      requirements_count: 0,
      suggested_response: 'fallback',
      timestamp: Date.now(),
    });

    try {
      const result = await tryHandleActiveServiceFollowUp({
        userId,
        message: 'ada link?',
        villageId: 'village-1',
        traceId: 'trace-active-service',
        startTime: Date.now(),
      });

      expect(result?.intent).toBe('SERVICE_INFO');
      expect(result?.response).toContain('Balas *iya*');
      expect(getPendingServiceFormOffer(userId)?.service_slug).toBe('surat-pengantar-ktp');
    } finally {
      clearActiveServiceInfo(userId);
      clearPendingServiceFormOffer(userId);
    }
  });

  it('keeps knowledge test follow-up informational without creating a link offer', async () => {
    const userId = 'active-service-knowledge-test';
    clearActiveServiceInfo(userId);
    clearPendingServiceFormOffer(userId);
    setActiveServiceInfo(userId, {
      service_slug: 'surat-pengantar-ktp',
      service_name: 'Surat Pengantar KTP',
      village_id: 'village-1',
      mode: 'online',
      is_online: true,
      can_send_form_link: false,
      estimated_cost: 'Gratis',
      estimated_processing_time: '1 hari kerja',
      requirements: [],
      requirements_count: 0,
      suggested_response: 'fallback',
      timestamp: Date.now(),
    });

    try {
      const result = await tryHandleActiveServiceFollowUp({
        userId,
        message: 'ada link?',
        villageId: 'village-1',
        traceId: 'trace-knowledge-test',
        startTime: Date.now(),
        sideEffectMode: 'knowledge_test',
      });

      expect(result?.intent).toBe('SERVICE_INFO');
      expect(result?.response).toContain('hanya untuk uji jawaban');
      expect(getPendingServiceFormOffer(userId)).toBeUndefined();
    } finally {
      clearActiveServiceInfo(userId);
      clearPendingServiceFormOffer(userId);
    }
  });
});

describe('agent service-info sufficiency stop', () => {
  it('stops after trusted service info for informational turns', () => {
    expect(shouldStopAfterSufficientServiceInfo('berapa lama?', [{
      toolName: 'get_service_info',
      result: {
        success: true,
        data: {
          found: true,
          suggested_response: 'Estimasi proses 1 hari kerja.',
        },
        meta: {
          trustLevel: 'trusted_fact',
          sourceKind: 'official_service_info',
        },
      },
    }])).toBe(true);
  });

  it('does not stop early when the user explicitly asks to send a link', () => {
    expect(shouldStopAfterSufficientServiceInfo('tolong kirim linknya', [{
      toolName: 'get_service_info',
      result: {
        success: true,
        data: {
          found: true,
          suggested_response: 'Layanan bisa diajukan online.',
        },
        meta: {
          trustLevel: 'trusted_fact',
          sourceKind: 'official_service_info',
        },
      },
    }])).toBe(false);
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
