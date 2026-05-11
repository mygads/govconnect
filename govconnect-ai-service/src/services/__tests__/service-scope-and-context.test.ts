import { describe, it, expect } from 'vitest';
import {
  __test_only__ as preAgentTestOnly,
  tryHandleActiveServiceFollowUp,
  tryHandleOutOfScopeGuard,
} from '../pre-agent-state-router.service';
import { __test_only__ as agentOrchestratorTestOnly } from '../agent/agent-orchestrator';
import { isCacheable } from '../response-cache.service';
import {
  clearActiveServiceInfo,
  clearPendingServiceFormOffer,
  getPendingServiceFormOffer,
  setActiveServiceInfo,
} from '../ump-state';

const {
  isPendingServiceFollowUp,
  isPendingServiceLinkRequest,
  isInformationalServiceLinkInquiry,
  isExplicitServiceActionRequest,
  isClearlyDifferentIntent,
  detectExplicitConfirmationReply,
  decideFastIntent,
  buildActiveServiceFollowUpReply,
  buildPendingServiceClarificationPrompt,
  resolvePendingServiceClarification,
  classifyActiveServiceFollowUpType,
} = preAgentTestOnly;

const {
  selectAllowedTools,
  derivePreferredToolReply,
  shouldStopAfterSufficientServiceInfo,
  getUncoveredMixedIntentFamilies,
  shouldForceMixedIntentContinuation,
  buildMixedIntentLoopExhaustedReply,
} = agentOrchestratorTestOnly;

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

  it('does not hard-block external public-service questions at the scope-guard layer', () => {
    const result = tryHandleOutOfScopeGuard({
      message: 'cara urus paspor bagaimana?',
      traceId: 'test-trace',
      startTime: Date.now(),
    });

    expect(result).toBeNull();
  });
});

describe('fast intent out-of-scope routing', () => {
  it('defers external public-service questions to the agent instead of hard-blocking', () => {
    expect(decideFastIntent({ message: 'cara urus paspor bagaimana?' })).toMatchObject({
      primaryIntent: 'knowledge_query',
      action: 'defer_to_agent',
      reasons: ['external_public_service_signal'],
    });
  });

  it('routes office-contact village queries to village profile instead of generic contact lookup', () => {
    expect(decideFastIntent({ message: 'nomor kantor desa berapa?' })).toMatchObject({
      primaryIntent: 'knowledge_query',
      action: 'defer_to_agent',
      reasons: ['village_profile_query'],
      allowedToolHints: ['get_village_profile'],
    });
  });

  it('routes non-office local knowledge queries to knowledge retrieval instead of village profile', () => {
    expect(decideFastIntent({ message: 'jadwal posyandu desa kapan?' })).toMatchObject({
      primaryIntent: 'knowledge_query',
      action: 'defer_to_agent',
      reasons: ['local_knowledge_query'],
      allowedToolHints: ['search_knowledge'],
    });
  });

  it('keeps clearly off-topic tutoring questions hard-blocked', () => {
    expect(decideFastIntent({ message: 'ajari saya javascript dong' })).toMatchObject({
      primaryIntent: 'out_of_scope',
      action: 'hard_block',
    });
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
    expect(isInformationalServiceLinkInquiry('ada link?')).toBe(true);
    expect(isExplicitServiceActionRequest('ada link?')).toBe(false);
    expect(isPendingServiceLinkRequest('formnya mana?')).toBe(true);
    expect(isInformationalServiceLinkInquiry('formnya mana?')).toBe(false);
    expect(isExplicitServiceActionRequest('formnya mana?')).toBe(true);
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
    expect(isClearlyDifferentIntent('nomor puskesmas dulu')).toBe(true);
    expect(isClearlyDifferentIntent('kantor desa buka jam berapa')).toBe(true);
    expect(isClearlyDifferentIntent('jadwal posyandu desa kapan')).toBe(true);
    expect(isClearlyDifferentIntent('bukan itu maksud saya')).toBe(true);
  });

  it('keeps explicit confirmation parsing stable', () => {
    expect(detectExplicitConfirmationReply('iya')).toBe('yes');
    expect(detectExplicitConfirmationReply('gak jadi')).toBe('no');
    expect(detectExplicitConfirmationReply('nanti dulu')).toBe('no');
    expect(detectExplicitConfirmationReply('oke makasih')).toBe('no');
    expect(detectExplicitConfirmationReply('berapa lama?')).toBe('uncertain');
  });

  it('marks pending offer link availability as informational, not action', () => {
    expect(decideFastIntent({ message: 'ada link?', hasPendingServiceOffer: true })).toMatchObject({
      primaryIntent: 'service_follow_up',
      action: 'handle_pre_agent',
      stateAffinity: 'answers_pending_state',
    });
    expect(decideFastIntent({ message: 'kirim linknya', hasPendingServiceOffer: true })).toMatchObject({
      primaryIntent: 'service_form_confirmation',
      action: 'handle_pre_agent',
      confidence: 'hard',
    });
  });

  it('defers pending service-offer turns that mix follow-up with another grounded fact request', () => {
    expect(decideFastIntent({ message: 'ada link dan kantor desa buka jam berapa?', hasPendingServiceOffer: true })).toMatchObject({
      primaryIntent: 'service_follow_up',
      action: 'defer_to_agent',
      mixedSignals: true,
      stateAffinity: 'answers_pending_state',
    });
  });

  it('releases pending clarification on clear topic shift', () => {
    expect(decideFastIntent({ message: 'nomor puskesmas dulu', hasPendingServiceClarification: true })).toMatchObject({
      action: 'release_state_and_defer',
      stateAffinity: 'switches_topic',
    });
  });

  it('releases pending state into village-profile routing for office-contact queries', () => {
    expect(decideFastIntent({ message: 'nomor kantor desa berapa?', hasPendingServiceClarification: true })).toMatchObject({
      primaryIntent: 'knowledge_query',
      action: 'release_state_and_defer',
      stateAffinity: 'switches_topic',
      reasons: ['pending_state_village_profile_topic_shift'],
      allowedToolHints: ['get_village_profile'],
    });
  });

  it('releases pending state into knowledge routing for non-office local knowledge queries', () => {
    expect(decideFastIntent({ message: 'jadwal posyandu desa kapan?', hasPendingServiceClarification: true })).toMatchObject({
      primaryIntent: 'knowledge_query',
      action: 'release_state_and_defer',
      stateAffinity: 'switches_topic',
      reasons: ['pending_state_local_knowledge_topic_shift'],
      allowedToolHints: ['search_knowledge'],
    });
  });

  it('releases pending clarification when the reply also shifts into another fact topic', () => {
    expect(decideFastIntent({ message: 'yang domisili dan kantor desa buka jam berapa?', hasPendingServiceClarification: true })).toMatchObject({
      action: 'release_state_and_defer',
      mixedSignals: true,
      stateAffinity: 'switches_topic',
    });
  });
});

describe('pending service clarification helpers', () => {
  const alternatives = [
    {
      slug: 'surat-pengantar-ktp',
      name: 'Surat Pengantar KTP',
      mode: 'online',
      is_online: true,
      can_send_form_link: true,
    },
    {
      slug: 'surat-domisili',
      name: 'Surat Keterangan Domisili',
      mode: 'offline',
      is_online: false,
      can_send_form_link: false,
    },
  ];

  it('resolves ordinal clarification replies deterministically', () => {
    expect(resolvePendingServiceClarification('nomor 2', alternatives)).toMatchObject({
      resolutionMethod: 'ordinal',
      selectedAlternative: {
        slug: 'surat-domisili',
      },
    });
  });

  it('resolves attribute-based clarification when exactly one online option exists', () => {
    expect(resolvePendingServiceClarification('yang online', alternatives)).toMatchObject({
      resolutionMethod: 'attribute',
      selectedAlternative: {
        slug: 'surat-pengantar-ktp',
      },
    });
  });

  it('resolves name-fragment clarification replies deterministically', () => {
    expect(resolvePendingServiceClarification('yang domisili', alternatives)).toMatchObject({
      resolutionMethod: 'name_fragment',
      selectedAlternative: {
        slug: 'surat-domisili',
      },
    });
  });

  it('builds a numbered clarification prompt', () => {
    const prompt = buildPendingServiceClarificationPrompt(alternatives);
    expect(prompt).toContain('1. Surat Pengantar KTP');
    expect(prompt).toContain('2. Surat Keterangan Domisili');
    expect(prompt).toContain('Balas dengan nomor atau nama layanannya ya.');
  });

  it('classifies active service follow-up types for observability', () => {
    expect(classifyActiveServiceFollowUpType('ada link?')).toBe('link');
    expect(classifyActiveServiceFollowUpType('berapa lama prosesnya?')).toBe('duration');
    expect(classifyActiveServiceFollowUpType('harus ke kantor?')).toBe('office_visit');
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

  it('defers active service follow-up when the message mixes another fact request', () => {
    expect(decideFastIntent({
      message: 'berapa lama dan kantor desa buka jam berapa?',
      hasActiveServiceInfo: true,
    })).toMatchObject({
      primaryIntent: 'service_follow_up',
      action: 'defer_to_agent',
      mixedSignals: true,
      stateAffinity: 'answers_pending_state',
    });
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

describe('agent preferred reply selection', () => {
  it('prefers official service facts over later retrieval suggestions', () => {
    expect(derivePreferredToolReply([
      {
        toolName: 'get_service_info',
        result: {
          success: true,
          data: {
            found: true,
            suggested_response: 'Biaya surat domisili gratis.',
          },
          meta: {
            trustLevel: 'trusted_fact',
            sourceKind: 'official_service_info',
          },
        },
      },
      {
        toolName: 'search_knowledge',
        result: {
          success: true,
          data: {
            found: true,
            suggested_response: 'Menurut knowledge lama, biayanya Rp25.000.',
          },
          meta: {
            trustLevel: 'untrusted_retrieval',
            sourceKind: 'knowledge_retrieval',
          },
        },
      },
    ])).toMatchObject({
      replyText: 'Biaya surat domisili gratis.',
    });
  });

  it('prefers official contact lookup over later retrieval suggestions', () => {
    expect(derivePreferredToolReply([
      {
        toolName: 'get_important_contact',
        result: {
          success: true,
          data: {
            found: true,
            suggested_response: '*Puskesmas Solo*\n081234567890',
          },
          meta: {
            trustLevel: 'trusted_fact',
            sourceKind: 'contact_directory_lookup',
          },
        },
      },
      {
        toolName: 'search_knowledge',
        result: {
          success: true,
          data: {
            found: true,
            suggested_response: 'Dokumen lama menyebut nomor puskesmas 089999999999.',
          },
          meta: {
            trustLevel: 'untrusted_retrieval',
            sourceKind: 'knowledge_retrieval',
          },
        },
      },
    ])).toMatchObject({
      replyText: '*Puskesmas Solo*\n081234567890',
    });
  });

  it('prefers action results over earlier informational service replies when both exist', () => {
    expect(derivePreferredToolReply([
      {
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
      },
      {
        toolName: 'create_service_request',
        result: {
          success: true,
          data: {
            ready: true,
            suggested_response: 'Baik Pak/Bu, saya kirim link formulir untuk layanan *Surat Domisili* ya.',
            guidance_text: 'Link formulir layanan:\nhttps://example.test/form',
          },
          meta: {
            trustLevel: 'action_result',
            sourceKind: 'service_request_link',
          },
        },
      },
    ])).toMatchObject({
      replyText: 'Baik Pak/Bu, saya kirim link formulir untuk layanan *Surat Domisili* ya.',
      guidanceText: 'Link formulir layanan:\nhttps://example.test/form',
    });
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

  it('does not stop early when a mixed service and contact turn only covered the service side', () => {
    expect(shouldStopAfterSufficientServiceInfo('biaya surat domisili dan nomor puskesmas berapa?', [{
      toolName: 'get_service_info',
      result: {
        success: true,
        data: {
          found: true,
          suggested_response: 'Biayanya gratis.',
        },
        meta: {
          trustLevel: 'trusted_fact',
          sourceKind: 'official_service_info',
        },
      },
    }])).toBe(false);
  });

  it('does not stop early once a mixed service and contact turn is fully covered, so the agent can still synthesize a natural final reply', () => {
    expect(shouldStopAfterSufficientServiceInfo('biaya surat domisili dan nomor puskesmas berapa?', [
      {
        toolName: 'get_service_info',
        result: {
          success: true,
          data: {
            found: true,
            suggested_response: 'Biayanya gratis.',
          },
          meta: {
            trustLevel: 'trusted_fact',
            sourceKind: 'official_service_info',
          },
        },
      },
      {
        toolName: 'get_important_contact',
        result: {
          success: true,
          data: {
            found: true,
            suggested_response: 'Nomor puskesmas tersedia.',
          },
          meta: {
            trustLevel: 'trusted_fact',
            sourceKind: 'official_contact_directory',
          },
        },
      },
    ])).toBe(false);
  });

  it('does not stop early when a mixed service and village-profile turn only covered the service side', () => {
    expect(shouldStopAfterSufficientServiceInfo('syarat surat domisili dan kantor desa buka jam berapa?', [{
      toolName: 'get_service_info',
      result: {
        success: true,
        data: {
          found: true,
          suggested_response: 'Syaratnya KTP dan KK.',
        },
        meta: {
          trustLevel: 'trusted_fact',
          sourceKind: 'official_service_info',
        },
      },
    }])).toBe(false);
  });

  it('does not stop early once mixed service and village-profile coverage is complete, so the agent can still synthesize a natural final reply', () => {
    expect(shouldStopAfterSufficientServiceInfo('syarat surat domisili dan kantor desa buka jam berapa?', [
      {
        toolName: 'get_service_info',
        result: {
          success: true,
          data: {
            found: true,
            suggested_response: 'Syaratnya KTP dan KK.',
          },
          meta: {
            trustLevel: 'trusted_fact',
            sourceKind: 'official_service_info',
          },
        },
      },
      {
        toolName: 'get_village_profile',
        result: {
          success: true,
          data: {
            found: true,
            suggested_response: 'Kantor desa buka sampai jam 15.00.',
          },
          meta: {
            trustLevel: 'trusted_fact',
            sourceKind: 'official_village_profile',
          },
        },
      },
    ])).toBe(false);
  });
});

describe('agent mixed-intent continuation guards', () => {
  it('detects the still-uncovered family after only one side of a mixed turn was grounded', () => {
    expect(getUncoveredMixedIntentFamilies('biaya surat domisili dan nomor puskesmas berapa?', ['get_service_info'])).toEqual(['contact']);
  });

  it('detects knowledge as still uncovered after only the service side of a mixed turn was grounded', () => {
    expect(getUncoveredMixedIntentFamilies('syarat surat domisili dan jadwal posyandu desa kapan?', ['get_service_info'])).toEqual(['knowledge']);
  });

  it('forces continuation when a mixed turn still has reachable tools left', () => {
    expect(shouldForceMixedIntentContinuation(
      'biaya surat domisili dan nomor puskesmas berapa?',
      ['get_service_info'],
      ['get_service_info', 'get_important_contact'],
    )).toBe(true);
  });

  it('forces continuation when a mixed service-plus-knowledge turn still has knowledge retrieval left', () => {
    expect(shouldForceMixedIntentContinuation(
      'syarat surat domisili dan jadwal posyandu desa kapan?',
      ['get_service_info'],
      ['get_service_info', 'search_knowledge'],
    )).toBe(true);
  });

  it('stops forcing continuation once all mixed families are covered', () => {
    expect(shouldForceMixedIntentContinuation(
      'biaya surat domisili dan nomor puskesmas berapa?',
      ['get_service_info', 'get_important_contact'],
      ['get_service_info', 'get_important_contact'],
    )).toBe(false);
  });

  it('builds a partial fallback that preserves the answered part on loop exhaustion', () => {
    const reply = buildMixedIntentLoopExhaustedReply(
      'biaya surat domisili dan nomor puskesmas berapa?',
      ['get_service_info'],
      ['get_service_info', 'get_important_contact'],
      'Biayanya gratis.',
    );

    expect(reply).toContain('Biayanya gratis.');
    expect(reply).toContain('Bagian kontak belum berhasil');
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

  it('marks contact directory lookup as required and hard-denies unrelated tools', async () => {
    const result = await selectAllowedTools('nomor puskesmas solo', {});

    expect(result.requiredTools).toContain('get_important_contact');
    expect(result.allowedToolNames).toEqual(['get_important_contact']);
    expect(result.hardDeniedTools).toContain('get_emergency_contacts');
    expect(result.hardDeniedTools).toContain('search_knowledge');
  });

  it('routes office-contact queries through village profile instead of generic contact lookup', async () => {
    const result = await selectAllowedTools('nomor kantor desa berapa?', {});

    expect(result.requiredTools).toContain('get_village_profile');
    expect(result.allowedToolNames).toEqual(['get_village_profile']);
    expect(result.hardDeniedTools).toContain('get_important_contact');
    expect(result.hardDeniedTools).toContain('search_knowledge');
    expect(result.hardDeniedTools).toContain('search_documents');
  });

  it('routes non-office local knowledge queries through search knowledge instead of village profile', async () => {
    const result = await selectAllowedTools('jadwal posyandu desa kapan?', {});

    expect(result.allowedToolNames).toEqual(['search_knowledge']);
    expect(result.allowedToolNames).not.toContain('get_village_profile');
    expect(result.hardDeniedTools).toContain('get_village_profile');
  });

  it('keeps mixed service and contact turns broad enough to answer both parts', async () => {
    const result = await selectAllowedTools('biaya surat domisili dan nomor puskesmas solo berapa?', {});

    expect(result.requiredTools).toContain('get_important_contact');
    expect(result.allowedToolNames).toContain('get_service_info');
    expect(result.allowedToolNames).toContain('get_important_contact');
    expect(result.allowedToolNames).not.toEqual(['get_important_contact']);
  });

  it('keeps mixed service and village-profile turns broad enough to answer both parts', async () => {
    const result = await selectAllowedTools('syarat surat domisili dan kantor desa buka jam berapa?', {});

    expect(result.requiredTools).toContain('get_village_profile');
    expect(result.allowedToolNames).toContain('get_service_info');
    expect(result.allowedToolNames).toContain('get_village_profile');
    expect(result.allowedToolNames).not.toContain('search_knowledge');
  });

  it('keeps mixed service and non-office local knowledge turns broad enough to answer both parts', async () => {
    const result = await selectAllowedTools('syarat surat domisili dan jadwal posyandu desa kapan?', {});

    expect(result.allowedToolNames).toContain('get_service_info');
    expect(result.allowedToolNames).toContain('search_knowledge');
    expect(result.allowedToolNames).not.toContain('get_village_profile');
  });

  it('keeps mixed status and village-profile turns broad enough to answer both parts', async () => {
    const result = await selectAllowedTools('cek status LAY-20260509-001 dan kantor desa buka jam berapa?', {});

    expect(result.requiredTools).toContain('check_status');
    expect(result.allowedToolNames).toContain('check_status');
    expect(result.allowedToolNames).toContain('get_village_profile');
  });

  it('marks village profile facts as required when that is the grounding path', async () => {
    const result = await selectAllowedTools('kantor desa buka jam berapa?', {});

    expect(result.requiredTools).toContain('get_village_profile');
    expect(result.allowedToolNames).toContain('get_village_profile');
  });

  it('keeps general retrieval tools out of structured service detail queries', async () => {
    const result = await selectAllowedTools('biaya surat domisili berapa?', {});

    expect(result.allowedToolNames).toContain('get_service_info');
    expect(result.allowedToolNames).not.toContain('search_knowledge');
    expect(result.allowedToolNames).not.toContain('search_documents');
  });

  it('keeps general retrieval tools out of structured village profile queries', async () => {
    const result = await selectAllowedTools('alamat kantor desa dimana?', {});

    expect(result.requiredTools).toContain('get_village_profile');
    expect(result.allowedToolNames).toContain('get_village_profile');
    expect(result.allowedToolNames).not.toContain('search_knowledge');
    expect(result.allowedToolNames).not.toContain('search_documents');
  });
});

describe('response cacheability rules', () => {
  it('does not cache short contextual service follow-ups', () => {
    expect(isCacheable('syaratnya?', 'SERVICE_INFO')).toBe(false);
    expect(isCacheable('ada link?', 'SERVICE_INFO')).toBe(false);
    expect(isCacheable('nomor 2', 'SERVICE_INFO')).toBe(false);
  });

  it('keeps explicit service listing queries cacheable', () => {
    expect(isCacheable('layanan apa aja', 'SERVICE_INFO')).toBe(true);
    expect(isCacheable('daftar layanan desa', 'SERVICE_INFO')).toBe(true);
  });

  it('keeps explicit standalone service detail questions cacheable', () => {
    expect(isCacheable('syarat buat surat domisili', 'SERVICE_INFO')).toBe(true);
    expect(isCacheable('biaya untuk akta kelahiran', 'SERVICE_INFO')).toBe(true);
  });
});
