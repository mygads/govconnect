import { beforeEach, describe, expect, it, vi } from 'vitest';

const testState = vi.hoisted(() => {
  const guardrailEvents: any[] = [];
  const services = [
    {
      id: 'svc-1',
      slug: 'surat-pengantar-ktp',
      name: 'Surat Pengantar KTP',
      description: 'Pengantar untuk pengurusan KTP.',
      is_active: true,
      mode: 'online',
      estimated_processing_time: '1 hari kerja',
      estimated_cost: 'Gratis',
      requirements: [
        {
          label: 'Fotokopi KK',
          field_type: 'file',
          is_required: true,
          help_text: null,
        },
      ],
      category: { name: 'Administrasi' },
    },
    {
      id: 'svc-2',
      slug: 'surat-domisili',
      name: 'Surat Keterangan Domisili',
      description: 'Keterangan domisili warga.',
      is_active: true,
      mode: 'offline',
      estimated_processing_time: '2 hari kerja',
      estimated_cost: 'Gratis',
      requirements: [
        {
          label: 'Fotokopi KTP',
          field_type: 'file',
          is_required: true,
          help_text: null,
        },
      ],
      category: { name: 'Administrasi' },
    },
  ];
  const conversationSessions = new Map<string, { wa_user_id: string; session_key: string; state_json: string; expires_at: Date }>();
  const buildSessionKey = (waUserId: string, sessionKey: string) => `${waUserId}:${sessionKey}`;

  const prismaMock = {
    $queryRaw: vi.fn(async () => []),
    $executeRaw: vi.fn(async () => 1),
    $transaction: vi.fn(async (callback: any) => callback(prismaMock)),
    conversation_sessions: {
      upsert: vi.fn(async ({ where, update, create }: any) => {
        const compositeKey = buildSessionKey(where.wa_user_id_session_key.wa_user_id, where.wa_user_id_session_key.session_key);
        const existing = conversationSessions.get(compositeKey);
        const nextValue = existing
          ? { ...existing, ...update }
          : { ...create };
        conversationSessions.set(compositeKey, nextValue);
        return nextValue;
      }),
      findUnique: vi.fn(async ({ where }: any) => {
        const compositeKey = buildSessionKey(where.wa_user_id_session_key.wa_user_id, where.wa_user_id_session_key.session_key);
        return conversationSessions.get(compositeKey) ?? null;
      }),
      delete: vi.fn(async ({ where }: any) => {
        const compositeKey = buildSessionKey(where.wa_user_id_session_key.wa_user_id, where.wa_user_id_session_key.session_key);
        const existing = conversationSessions.get(compositeKey);
        if (!existing) throw new Error('Not found');
        conversationSessions.delete(compositeKey);
        return existing;
      }),
      deleteMany: vi.fn(async ({ where }: any = {}) => {
        let deletedCount = 0;
        for (const [compositeKey, session] of conversationSessions.entries()) {
          const matchesUser = !where?.wa_user_id || session.wa_user_id === where.wa_user_id;
          const matchesExpiry = !where?.expires_at?.lt || session.expires_at < where.expires_at.lt;
          if (matchesUser && matchesExpiry) {
            conversationSessions.delete(compositeKey);
            deletedCount += 1;
          }
        }
        return { count: deletedCount };
      }),
    },
  };

  return { guardrailEvents, services, prismaMock, conversationSessions };
});

const crossChannelState = vi.hoisted(() => ({
  enabled: false,
  block: '',
  linkCalls: [] as Array<{ userId: string; phoneNumber: string }>,
  updateCalls: [] as Array<{ userId: string; data: Record<string, unknown> }>,
  activityCalls: [] as string[],
}));

vi.mock('../../lib/prisma', () => ({
  default: testState.prismaMock,
}));

vi.mock('../runtime-observability.service', () => ({
  recordGuardrailEvent: vi.fn(async (input: any) => {
    testState.guardrailEvents.push(input);
  }),
  recordMemoryTrace: vi.fn(async () => {}),
}));

vi.mock('../rag.service', () => ({
  isSpamMessage: vi.fn(() => false),
}));

vi.mock('../ai-wallet.service', () => ({
  canProcessVillageAI: vi.fn(async () => ({ allowed: true, balanceUsd: 10, status: 'ok' })),
}));

vi.mock('../processing-status.service', () => ({
  createProcessingTracker: vi.fn(() => ({
    reading: vi.fn(),
    thinking: vi.fn(),
    complete: vi.fn(),
    error: vi.fn(),
  })),
}));

vi.mock('../ump-formatters', () => ({
  validateResponse: vi.fn((value: string) => value),
  normalizeHandlerResult: vi.fn((value: any) => value),
  buildCancelErrorResponse: vi.fn(),
  buildCancelSuccessResponse: vi.fn(),
  buildImportantContactsMessage: vi.fn(),
  buildChannelParams: vi.fn(() => ({})),
  toVCardContacts: vi.fn(() => []),
}));

vi.mock('../context-builder.service', () => ({
  sanitizeUserInput: vi.fn((value: string) => value),
}));

vi.mock('../knowledge.service', () => ({
  getVillageProfileSummary: vi.fn(async () => null),
}));

vi.mock('../user-profile.service', () => ({
  getAutoFillSuggestionsWithFallback: vi.fn(async () => ({ nama_lengkap: null })),
  updateProfile: vi.fn(async () => {}),
  recordServiceUsage: vi.fn(async () => {}),
}));

vi.mock('../text-normalizer.service', () => ({
  normalizeText: vi.fn((value: string) => value),
}));

vi.mock('../micro-llm-matcher.service', () => ({
  classifyMessage: vi.fn(async () => null),
  analyzeAddress: vi.fn(async () => null),
}));

vi.mock('../ai-analytics.service', () => ({
  aiAnalyticsService: {
    recordInteractionEvent: vi.fn(async () => {}),
  },
}));

vi.mock('../fallback-response.service', () => ({
  getSmartFallback: vi.fn(() => 'fallback'),
  getErrorFallback: vi.fn(() => 'fallback'),
}));

vi.mock('../cross-channel-context.service', () => ({
  isCrossChannelEnabled: vi.fn(() => crossChannelState.enabled),
  getCrossChannelContextForLLM: vi.fn(() => crossChannelState.block),
  linkUserToPhone: vi.fn((userId: string, phoneNumber: string) => {
    crossChannelState.linkCalls.push({ userId, phoneNumber });
  }),
  updateSharedData: vi.fn((userId: string, data: Record<string, unknown>) => {
    crossChannelState.updateCalls.push({ userId, data });
  }),
  recordChannelActivity: vi.fn((userId: string) => {
    crossChannelState.activityCalls.push(userId);
  }),
}));

vi.mock('../response-cache.service', () => ({
  getCachedResponse: vi.fn(() => null),
  setCachedResponse: vi.fn(() => {}),
}));

vi.mock('../hybrid-memory.service', () => ({
  buildHybridMemorySummary: vi.fn(async () => undefined),
  rememberMemoryEvent: vi.fn(async () => {}),
}));

vi.mock('../agent/tool-policy.service', () => ({
  recordToolPolicyEvent: vi.fn(async () => {}),
}));

vi.mock('../tool-execution-trace.service', () => ({
  recordToolExecutionTraces: vi.fn(async () => {}),
}));

vi.mock('../sentiment-analysis.service', () => ({
  analyzeSentimentWithLLM: vi.fn(async () => ({ level: 'neutral' })),
  getSentimentContext: vi.fn(() => ''),
  needsHumanEscalation: vi.fn(() => false),
}));

vi.mock('../promise-tracker.service', () => ({
  extractAndRecordPromises: vi.fn(() => []),
  listOpenPromises: vi.fn(() => []),
  resolvePromisesByKind: vi.fn(() => {}),
  buildOpenPromisesContext: vi.fn(() => ''),
  deriveFulfilledPromisesFromTools: vi.fn(() => []),
  resolveForwardPromiseOnTakeover: vi.fn(() => {}),
  _resetPromiseStoreForTests: vi.fn(() => {}),
}));

vi.mock('../stuck-user-tracker.service', () => ({
  recordUnhelpful: vi.fn(() => 0),
  recordHelpful: vi.fn(() => {}),
  isStuck: vi.fn(() => false),
  buildStuckEscalationSuffix: vi.fn(() => ''),
}));

vi.mock('../channel-client.service', () => ({
  startTakeoverForUser: vi.fn(async () => false),
  updateConversationUserProfile: vi.fn(async () => true),
}));

vi.mock('../conversation-context.service', () => ({
  getEnhancedContext: vi.fn(() => ({ conversationSummary: '' })),
}));

vi.mock('../village-behavior.service', () => ({
  getVillageBehaviorConfig: vi.fn(async () => null),
  formatVillageBehaviorConfig: vi.fn(() => ''),
}));

vi.mock('../ai-turn-billing.service', () => ({
  startAiBillingTurn: vi.fn(() => null),
  finishAiBillingTurn: vi.fn(async () => {}),
}));

vi.mock('../media-analysis.service', () => ({
  analyzeIncomingMedia: vi.fn(async () => null),
}));

vi.mock('../ump-utils', () => ({
  fetchConversationHistoryFromChannel: vi.fn(async () => []),
  appendToHistoryCache: vi.fn(() => {}),
  buildAgentConversationContext: vi.fn(async () => ({ summary: undefined, recentMessages: [] })),
  deriveLastDiscussedServiceContext: vi.fn(() => ({})),
  extractAddressFromMessage: vi.fn(() => undefined),
  extractNameFromTextNLU: vi.fn(() => undefined),
}));

vi.mock('../complaint-handler', () => ({
  handleComplaintCreation: vi.fn(async () => ({ replyText: 'complaint' })),
  handleComplaintUpdate: vi.fn(async () => ({ replyText: 'update complaint' })),
  handleCancellationRequest: vi.fn(async () => ({ replyText: 'cancel complaint' })),
  handleHistory: vi.fn(async () => ({ replyText: 'history' })),
  handlePendingAddressConfirmation: vi.fn(async () => null),
}));

vi.mock('../service-handler', () => ({
  handleServiceInfo: vi.fn(async () => ({ replyText: 'service info' })),
  handleServiceRequestCreation: vi.fn(async () => ({ replyText: 'service create' })),
  handleServiceRequestEditLink: vi.fn(async () => ({ replyText: 'service edit link' })),
}));

vi.mock('../status-handler', () => ({
  handleStatusCheck: vi.fn(async () => ({ replyText: 'status' })),
}));

vi.mock('../agent', () => ({
  runAgent: vi.fn(async () => ({
    replyText: 'agent reply',
    toolsUsed: [],
    heuristicTools: [],
    learnedTools: [],
    allowedToolNames: [],
    toolPolicyReason: 'test',
    firstTurnToolChoice: 'auto',
    firstTurnToolChoiceReason: 'test',
    toolTrace: [],
    totalTokens: 0,
    iterations: 1,
    model: 'test-model',
    durationMs: 1,
  })),
}));

vi.mock('../case-client.service', () => ({
  getServiceCatalog: vi.fn(async () => testState.services),
  getServiceRequirements: vi.fn(async (serviceIdOrSlug: string) => {
    const service = testState.services.find((item: any) => item.id === serviceIdOrSlug || item.slug === serviceIdOrSlug);
    return service?.requirements || [];
  }),
  buildServiceInfoContext: vi.fn(async (service: any, options: any = {}) => {
    const requirements = Array.isArray(service.requirements) ? service.requirements : [];
    const formattedRequirements = requirements.map((requirement: any) => ({
      label: requirement.label,
      type: requirement.field_type,
      required: requirement.is_required,
      help_text: requirement.help_text || null,
    }));
    const isOnline = service.mode === 'online' || service.mode === 'both';
    const canOfferFormLink = isOnline && options.allowFormLinkOffer !== false;
    let replyText = `Baik, untuk layanan *${service.name}* persyaratannya seperti ini:\n\n`;
    if (requirements.length > 0) {
      replyText += requirements
        .map((requirement: any, index: number) => `${index + 1}. ${requirement.label}${requirement.is_required ? ' (wajib)' : ' (opsional)'}`)
        .join('\n');
      replyText += '\n\n';
    } else if (service.description) {
      replyText += `${service.description}\n\n`;
    }
    if (!isOnline) {
      replyText += 'Layanan ini diproses langsung di kantor desa. Silakan datang dengan membawa persyaratan di atas ya.';
    }
    const guidanceText = canOfferFormLink
      ? `Kalau Bapak/Ibu mau lanjut, saya bisa kirimkan link formulir terkait *${service.name}*.`
      : undefined;
    const suggestedResponse = guidanceText ? `${replyText}\n\n${guidanceText}` : replyText;

    return {
      service,
      requirements,
      formattedRequirements,
      requirementsText: '',
      replyText,
      guidanceText,
      suggestedResponse,
      isOnline,
      canOfferFormLink,
      activeService: {
        service_slug: service.slug,
        service_name: service.name,
        village_id: options.villageId,
        mode: service.mode || null,
        is_online: isOnline,
        can_send_form_link: canOfferFormLink,
        estimated_cost: service.estimated_cost || null,
        estimated_processing_time: service.estimated_processing_time || null,
        requirements: formattedRequirements,
        requirements_count: requirements.length,
        suggested_response: suggestedResponse,
        timestamp: Date.now(),
      },
    };
  }),
  cancelComplaint: vi.fn(async () => null),
  cancelServiceRequest: vi.fn(async () => null),
  getUserHistory: vi.fn(async () => []),
}));

import { runAgent } from '../agent';
import { canProcessVillageAI } from '../ai-wallet.service';
import { getCachedResponse } from '../response-cache.service';
import { buildHybridMemorySummary } from '../hybrid-memory.service';
import {
  getCrossChannelContextForLLM,
  isCrossChannelEnabled,
  linkUserToPhone,
  recordChannelActivity,
  updateSharedData,
} from '../cross-channel-context.service';
import { __test_only__, processUnifiedMessage } from '../unified-message-processor.service';
import { getAutoFillSuggestionsWithFallback } from '../user-profile.service';
import { deriveLastDiscussedServiceContext } from '../ump-utils';
import {
  clearActiveServiceInfo,
  clearPendingServiceClarification,
  clearPendingServiceFormOffer,
  getPendingServiceClarification,
  getPendingServiceFormOffer,
  setPendingServiceClarification,
  setPendingServiceFormOffer,
} from '../ump-state';

describe('isExplicitHumanHandoffRequest', () => {
  it('treats a direct human handoff request as explicit', () => {
    expect(__test_only__.isExplicitHumanHandoffRequest('minta disambungkan ke petugas')).toBe(true);
    expect(__test_only__.isExplicitHumanHandoffRequest('cs manusia dong')).toBe(true);
    expect(__test_only__.isExplicitHumanHandoffRequest('operator')).toBe(true);
  });

  it('does not escalate plain dissatisfaction by itself', () => {
    expect(__test_only__.isExplicitHumanHandoffRequest('ini tidak membantu')).toBe(false);
    expect(__test_only__.isExplicitHumanHandoffRequest('jawabannya jelek')).toBe(false);
    expect(__test_only__.isExplicitHumanHandoffRequest('komplain cs')).toBe(false);
  });
});

describe('classifyHelpfulnessForStuck', () => {
  it('treats short clarifying prompts as helpful instead of retrieval-empty', () => {
    expect(__test_only__.classifyHelpfulnessForStuck({
      success: true,
      response: 'Mohon sebutkan nama layanannya ya?',
      intent: 'SERVICE_INFO',
      metadata: {
        processingTimeMs: 1,
        hasKnowledge: false,
        toolsUsed: [],
      },
    } as any)).toBe('helpful');
  });

  it('keeps very short unguided replies classified as retrieval-empty', () => {
    expect(__test_only__.classifyHelpfulnessForStuck({
      success: true,
      response: 'Belum ada.',
      intent: 'QUESTION',
      metadata: {
        processingTimeMs: 1,
        hasKnowledge: false,
        toolsUsed: [],
      },
    } as any)).toBe('retrieval_empty');
  });
});

describe('processUnifiedMessage service clarification flow', () => {
  const userId = 'ump-clarification-user';
  const villageId = 'village-1';

  beforeEach(() => {
    testState.guardrailEvents.length = 0;
    testState.conversationSessions.clear();
    vi.mocked(canProcessVillageAI).mockClear();
    vi.mocked(canProcessVillageAI).mockResolvedValue({ allowed: true, balanceUsd: 10, status: 'ok' } as any);
    vi.mocked(getCachedResponse).mockClear();
    vi.mocked(getCachedResponse).mockReturnValue(null as any);
    vi.mocked(buildHybridMemorySummary).mockResolvedValue(undefined as any);
    vi.mocked(getAutoFillSuggestionsWithFallback).mockResolvedValue({ nama_lengkap: null } as any);
    vi.mocked(deriveLastDiscussedServiceContext).mockReturnValue({});
    vi.mocked(runAgent).mockClear();
    crossChannelState.enabled = false;
    crossChannelState.block = '';
    crossChannelState.linkCalls.length = 0;
    crossChannelState.updateCalls.length = 0;
    crossChannelState.activityCalls.length = 0;
    clearActiveServiceInfo(userId);
    clearPendingServiceClarification(userId);
    clearPendingServiceFormOffer(userId);
  });

  it('resolves pending service clarification before agent execution', async () => {
    setPendingServiceClarification(userId, {
      original_query: 'surat ktp',
      village_id: villageId,
      source: 'get_service_info',
      timestamp: Date.now(),
      alternatives: [
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
      ],
    });

    const result = await processUnifiedMessage({
      userId,
      message: 'nomor 2',
      channel: 'webchat',
      villageId,
      conversationHistory: [],
      isEvaluation: true,
    });

    expect(result.intent).toBe('SERVICE_INFO');
    expect(result.response).toContain('Surat Keterangan Domisili');
    expect(result.metadata.guardrail?.type).toBe('service_clarification');
    expect(result.metadata.guardrail?.action).toBe('resolved');
    expect(getPendingServiceClarification(userId)).toBeUndefined();
    expect(testState.guardrailEvents.at(-1)?.guardType).toBe('service_clarification');
    expect(testState.guardrailEvents.at(-1)?.metadata).toMatchObject({
      selectedServiceSlug: 'surat-domisili',
      source: 'get_service_info',
    });
  });

  it('uses active service follow-up after clarification resolution', async () => {
    setPendingServiceClarification(userId, {
      original_query: 'surat warga',
      village_id: villageId,
      source: 'handle_service_info',
      timestamp: Date.now(),
      alternatives: [
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
      ],
    });

    await processUnifiedMessage({
      userId,
      message: 'nomor 2',
      channel: 'webchat',
      villageId,
      conversationHistory: [],
      isEvaluation: true,
    });

    const result = await processUnifiedMessage({
      userId,
      message: 'harus ke kantor?',
      channel: 'webchat',
      villageId,
      conversationHistory: [],
      isEvaluation: true,
    });

    expect(result.intent).toBe('SERVICE_INFO');
    expect(result.response).toContain('diproses di kantor desa');
    expect(result.metadata.guardrail?.type).toBe('active_service_follow_up');
    expect(testState.guardrailEvents.at(-1)?.guardType).toBe('active_service_follow_up');
    expect(testState.guardrailEvents.at(-1)?.metadata).toMatchObject({
      serviceSlug: 'surat-domisili',
      followUpType: 'office_visit',
    });
  });

  it('prefers active service state over history-derived service context when both exist', async () => {
    vi.mocked(deriveLastDiscussedServiceContext).mockReturnValue({
      serviceName: 'Surat Pengantar KTP',
      serviceSlug: 'surat-pengantar-ktp',
    });

    setPendingServiceClarification(userId, {
      original_query: 'surat warga',
      village_id: villageId,
      source: 'handle_service_info',
      timestamp: Date.now(),
      alternatives: [
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
      ],
    });

    await processUnifiedMessage({
      userId,
      message: 'nomor 2',
      channel: 'webchat',
      villageId,
      conversationHistory: [],
      isEvaluation: true,
    });

    await processUnifiedMessage({
      userId,
      message: 'bukan itu maksud saya',
      channel: 'webchat',
      villageId,
      conversationHistory: [
        { role: 'assistant', content: 'Untuk layanan *Surat Pengantar KTP*, pengajuannya online ya Pak/Bu.' },
      ],
      isEvaluation: true,
    });

    const conversationCtx = vi.mocked(runAgent).mock.calls.at(-1)?.[2] as any;
    expect(conversationCtx.activeServiceSlug).toBe('surat-domisili');
    expect(conversationCtx.activeServiceName).toBe('Surat Keterangan Domisili');
  });

  it('defers ambiguous clarification replies to the agent instead of hard re-prompting', async () => {
    setPendingServiceClarification(userId, {
      original_query: 'surat warga',
      village_id: villageId,
      source: 'handle_service_info',
      timestamp: Date.now(),
      alternatives: [
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
      ],
    });

    const result = await processUnifiedMessage({
      userId,
      message: 'iya',
      channel: 'webchat',
      villageId,
      conversationHistory: [],
      isEvaluation: true,
    });

    expect(result.response).toBe('agent reply');
    expect(getPendingServiceClarification(userId)?.alternatives).toHaveLength(2);
    expect((result.metadata as any).routingOutcome).toMatchObject({
      outcome: 'deferred_to_agent',
      reason: 'pending_service_clarification',
    });
    expect(runAgent).toHaveBeenCalled();
  });

  it('releases pending clarification state and defers on clear topic shift', async () => {
    setPendingServiceClarification(userId, {
      original_query: 'surat warga',
      village_id: villageId,
      source: 'handle_service_info',
      timestamp: Date.now(),
      alternatives: [
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
      ],
    });

    const result = await processUnifiedMessage({
      userId,
      message: 'bukan itu maksud saya',
      channel: 'webchat',
      villageId,
      conversationHistory: [],
      isEvaluation: true,
    });

    expect(result.response).toBe('agent reply');
    expect(getPendingServiceClarification(userId)).toBeUndefined();
    expect((result.metadata as any).routingOutcome).toMatchObject({
      outcome: 'released_state_and_deferred',
      reason: 'pending_clarification_topic_shift',
      releasedStates: ['pending_service_clarification'],
    });
    expect(runAgent).toHaveBeenCalled();
  });
});

describe('processUnifiedMessage pending service offer flow', () => {
  const userId = 'ump-pending-offer-user';
  const villageId = 'village-1';

  beforeEach(() => {
    testState.guardrailEvents.length = 0;
    testState.conversationSessions.clear();
    vi.mocked(canProcessVillageAI).mockClear();
    vi.mocked(canProcessVillageAI).mockResolvedValue({ allowed: true, balanceUsd: 10, status: 'ok' } as any);
    vi.mocked(getCachedResponse).mockClear();
    vi.mocked(getCachedResponse).mockReturnValue(null as any);
    vi.mocked(buildHybridMemorySummary).mockResolvedValue(undefined as any);
    vi.mocked(getAutoFillSuggestionsWithFallback).mockResolvedValue({ nama_lengkap: null } as any);
    vi.mocked(deriveLastDiscussedServiceContext).mockReturnValue({});
    vi.mocked(runAgent).mockClear();
    crossChannelState.enabled = false;
    crossChannelState.block = '';
    crossChannelState.linkCalls.length = 0;
    crossChannelState.updateCalls.length = 0;
    crossChannelState.activityCalls.length = 0;
    clearActiveServiceInfo(userId);
    clearPendingServiceClarification(userId);
    clearPendingServiceFormOffer(userId);
  });

  it('keeps pending offer informational when user only asks whether a link exists', async () => {
    setPendingServiceFormOffer(userId, {
      service_slug: 'surat-pengantar-ktp',
      village_id: villageId,
      timestamp: Date.now(),
    });

    const result = await processUnifiedMessage({
      userId,
      message: 'ada link?',
      channel: 'webchat',
      villageId,
      conversationHistory: [],
      isEvaluation: true,
    });

    expect(result.intent).toBe('SERVICE_INFO');
    expect(result.response).not.toContain('service create');
    expect(getPendingServiceFormOffer(userId)?.service_slug).toBe('surat-pengantar-ktp');
  });

  it('creates a service request only when the user explicitly asks for the link', async () => {
    setPendingServiceFormOffer(userId, {
      service_slug: 'surat-pengantar-ktp',
      village_id: villageId,
      timestamp: Date.now(),
    });

    const result = await processUnifiedMessage({
      userId,
      message: 'kirim linknya',
      channel: 'webchat',
      villageId,
      conversationHistory: [],
      isEvaluation: true,
    });

    expect(result.intent).toBe('CREATE_SERVICE_REQUEST');
    expect(result.response).toContain('service create');
    expect(getPendingServiceFormOffer(userId)).toBeUndefined();
  });

  it('checks the wallet gate only once per message', async () => {
    const result = await processUnifiedMessage({
      userId,
      message: 'halo',
      channel: 'webchat',
      villageId,
      conversationHistory: [],
      isEvaluation: true,
    });

    expect(result.response).toContain('Ada yang bisa saya bantu?');
    expect(canProcessVillageAI).toHaveBeenCalledTimes(1);
  });

  it('skips response cache while pending state is active', async () => {
    setPendingServiceFormOffer(userId, {
      service_slug: 'surat-pengantar-ktp',
      village_id: villageId,
      timestamp: Date.now(),
    });
    vi.mocked(getCachedResponse).mockReturnValue({ response: 'cached stale answer' } as any);

    const result = await processUnifiedMessage({
      userId,
      message: 'syaratnya?',
      channel: 'webchat',
      villageId,
      conversationHistory: [],
      isEvaluation: false,
    });

    expect(result.response).not.toBe('cached stale answer');
    expect(getCachedResponse).not.toHaveBeenCalled();
  });

  it('uses cached official service info when cache provenance includes the grounding tool', async () => {
    vi.mocked(getCachedResponse).mockReturnValue({
      response: 'Surat Keterangan Domisili gratis dan estimasi prosesnya 2 hari kerja.',
      intent: 'SERVICE_INFO',
      toolsUsed: ['get_service_info'],
    } as any);

    const result = await processUnifiedMessage({
      userId,
      message: 'biaya surat domisili berapa?',
      channel: 'webchat',
      villageId,
      conversationHistory: [],
      isEvaluation: false,
    });

    expect(result.response).toContain('Surat Keterangan Domisili gratis');
    expect((result.metadata as any).answerPolicy).toMatchObject({
      ok: true,
      reason: 'grounded_via_service_tool',
    });
    expect(runAgent).not.toHaveBeenCalled();
  });

  it('rewrites cached structured facts when cache provenance is missing', async () => {
    vi.mocked(getCachedResponse).mockReturnValue({
      response: 'Surat Keterangan Domisili biayanya Rp 25.000.',
      intent: 'SERVICE_INFO',
      toolsUsed: [],
    } as any);

    const result = await processUnifiedMessage({
      userId,
      message: 'biaya surat domisili berapa?',
      channel: 'webchat',
      villageId,
      conversationHistory: [],
      isEvaluation: false,
    });

    expect(result.response).not.toContain('Rp 25.000');
    expect((result.metadata as any).answerPolicy).toMatchObject({
      ok: false,
      rewritten: true,
      reason: 'service_detail_without_tool',
    });
    expect(runAgent).not.toHaveBeenCalled();
  });

  it('passes routing and pending-state context into the agent for ambiguous turns', async () => {
    setPendingServiceFormOffer(userId, {
      service_slug: 'surat-pengantar-ktp',
      village_id: villageId,
      timestamp: Date.now(),
    });

    await processUnifiedMessage({
      userId,
      message: 'bukan itu maksud saya',
      channel: 'webchat',
      villageId,
      conversationHistory: [],
      isEvaluation: true,
    });

    const promptCtx = vi.mocked(runAgent).mock.calls.at(-1)?.[1] as any;
    expect(promptCtx.routingDecision).toMatchObject({ stateAffinity: 'switches_topic' });
    expect(promptCtx.pendingStateSummary).toContain('Pending tawaran link layanan');
  });

  it('keeps cross-channel memory enrichment disabled when the feature flag is off', async () => {
    vi.mocked(buildHybridMemorySummary).mockResolvedValue('Riwayat penting user' as any);

    setPendingServiceFormOffer(userId, {
      service_slug: 'surat-pengantar-ktp',
      village_id: villageId,
      timestamp: Date.now(),
    });

    await processUnifiedMessage({
      userId,
      message: 'bukan itu maksud saya',
      channel: 'webchat',
      villageId,
      conversationHistory: [],
      isEvaluation: false,
    });

    const promptCtx = vi.mocked(runAgent).mock.calls.at(-1)?.[1] as any;
    expect(vi.mocked(isCrossChannelEnabled)).toHaveBeenCalled();
    expect(promptCtx.memorySummary).toBe('Riwayat penting user');
    expect(vi.mocked(linkUserToPhone)).not.toHaveBeenCalled();
    expect(vi.mocked(updateSharedData)).not.toHaveBeenCalled();
    expect(vi.mocked(recordChannelActivity)).not.toHaveBeenCalled();
    expect(vi.mocked(getCrossChannelContextForLLM)).not.toHaveBeenCalled();
  });

  it('enriches memory and syncs shared profile data when cross-channel is enabled', async () => {
    crossChannelState.enabled = true;
    crossChannelState.block = '[CROSS-CHANNEL CONTEXT]\n[NAMA USER: Warga Test]';
    vi.mocked(buildHybridMemorySummary).mockResolvedValue('Riwayat penting user' as any);
    vi.mocked(getAutoFillSuggestionsWithFallback).mockResolvedValue({
      nama_lengkap: 'Warga Test',
      no_hp: '081234567890',
      alamat: 'Jl. Melati 1',
      rt_rw: 'RT 01 / RW 02',
      nik: '1234567890123456',
    } as any);

    setPendingServiceFormOffer(userId, {
      service_slug: 'surat-pengantar-ktp',
      village_id: villageId,
      timestamp: Date.now(),
    });

    await processUnifiedMessage({
      userId,
      message: 'bukan itu maksud saya',
      channel: 'webchat',
      villageId,
      conversationHistory: [],
      isEvaluation: false,
    });

    const promptCtx = vi.mocked(runAgent).mock.calls.at(-1)?.[1] as any;
    expect(promptCtx.memorySummary).toContain('Riwayat penting user');
    expect(promptCtx.memorySummary).toContain('[CROSS-CHANNEL CONTEXT]');
    expect(vi.mocked(linkUserToPhone)).toHaveBeenCalledWith(userId, '081234567890');
    expect(vi.mocked(updateSharedData)).toHaveBeenCalledWith(userId, {
      name: 'Warga Test',
      nik: '1234567890123456',
      address: 'Jl. Melati 1, RT 01 / RW 02',
    });
    expect(vi.mocked(recordChannelActivity)).toHaveBeenCalledWith(userId);
    expect(vi.mocked(getCrossChannelContextForLLM)).toHaveBeenCalledWith(userId);
  });
});
