/**
 * Two-Layer LLM Orchestrator Service
 * 
 * Coordinates Layer 1 (Intent & Understanding) and Layer 2 (Response Generation)
 * for better accuracy, reliability, and cost efficiency
 * 
 * Flow:
 * 1. Layer 1: Understand intent, extract data, normalize language
 * 2. Validation: Check data completeness and confidence
 * 3. Layer 2: Generate natural, helpful responses
 * 4. Post-processing: Handle actions (create complaint/service request, etc.)
 */

import logger from '../utils/logger';
import { MessageReceivedEvent } from '../types/event.types';
import { callLayer1LLM, Layer1Output, applyTypoCorrections } from './layer1-llm.service';
import { callLayer2LLM, Layer2Output, generateFallbackResponse } from './layer2-llm.service';
import { publishAIReply, publishMessageStatus } from './rabbitmq.service';
import { isAIChatbotEnabled } from './settings.service';
import { startTyping, stopTyping, isUserInTakeover, markMessagesAsRead } from './channel-client.service';
import { aiAnalyticsService } from './ai-analytics.service';
import { isSpamMessage, shouldRetrieveContext } from './rag.service';
import { sanitizeUserInput } from './context-builder.service';
import { detectLanguage } from './language-detection.service';
import { analyzeSentiment, needsHumanEscalation } from './sentiment-analysis.service';
import { getKelurahanInfoContext, getRAGContext } from './knowledge.service';
import {
  appendAntiHallucinationInstruction,
  logAntiHallucinationEvent,
  needsAntiHallucinationRetry,
} from './anti-hallucination.service';

import { getUserHistory } from './case-client.service';

type CachedServiceCatalog = {
  expiresAt: number;
  services: Array<{ name?: string; slug?: string }>;
};

const serviceCatalogCache = new Map<string, CachedServiceCatalog>();
const SERVICE_CATALOG_CACHE_TTL_MS = 5 * 60 * 1000;

type PendingServiceDisambiguation = {
  villageId: string;
  candidates: Array<{ slug: string; name: string }>;
  timestamp: number;
};

const pendingServiceDisambiguation = new Map<string, PendingServiceDisambiguation>();
const PENDING_SERVICE_DISAMBIGUATION_TTL_MS = 3 * 60 * 1000;

function cleanupPendingServiceDisambiguation(): void {
  const now = Date.now();
  for (const [key, value] of pendingServiceDisambiguation.entries()) {
    if (now - value.timestamp > PENDING_SERVICE_DISAMBIGUATION_TTL_MS) {
      pendingServiceDisambiguation.delete(key);
    }
  }
}

async function getServiceCatalogForVillage(villageId: string): Promise<Array<{ name?: string; slug?: string }>> {
  const cached = serviceCatalogCache.get(villageId);
  if (cached && cached.expiresAt > Date.now()) return cached.services;

  try {
    const axios = (await import('axios')).default;
    const { config } = await import('../config/env');

    const response = await axios.get(`${config.caseServiceUrl}/services`, {
      params: { village_id: villageId },
      headers: { 'x-internal-api-key': config.internalApiKey },
      timeout: 5000,
    });

    const services = Array.isArray(response.data?.data) ? response.data.data : [];
    serviceCatalogCache.set(villageId, {
      expiresAt: Date.now() + SERVICE_CATALOG_CACHE_TTL_MS,
      services,
    });
    return services;
  } catch (error: any) {
    logger.warn('Failed to fetch service catalog', { villageId, error: error.message });
    return [];
  }
}

async function resolveServiceSlugHeuristic(villageId: string, message: string): Promise<string | null> {
  const services = await getServiceCatalogForVillage(villageId);
  if (!services.length) return null;

  const normalizedMessage = (message || '').toLowerCase();

  const stopwords = new Set([
    'syarat', 'persyaratan', 'berkas', 'dokumen', 'buat', 'bikin', 'pembuatan', 'mengurus', 'urus', 'minta', 'mohon',
    'cara', 'bagaimana', 'apa', 'saja', 'yang', 'untuk', 'dan', 'atau', 'dengan', 'dari', 'ke', 'di', 'pada', 'ini', 'itu',
    'kak', 'pak', 'bu', 'bapak', 'ibu', 'mas', 'mbak', 'saya', 'aku', 'kami', 'kita', 'tolong', 'bantu', 'online', 'form',
    'layanan', 'pelayanan', 'pengajuan', 'permohonan',
  ]);

  const tokenize = (text: string): string[] => {
    const cleaned = (text || '')
      .toLowerCase()
      .replace(/[^a-z0-9\s-]/g, ' ')
      .replace(/[-_]/g, ' ');

    return cleaned
      .split(/\s+/)
      .map(t => t.trim())
      .filter(Boolean)
      .filter(t => (t.length >= 3 || /^(kk|ktp|nik|npwp|akte)$/i.test(t)))
      .filter(t => !stopwords.has(t));
  };

  const messageTokens = new Set(tokenize(normalizedMessage));
  if (messageTokens.size === 0) return null;

  const scoreService = (service: { name?: string; slug?: string }): number => {
    const name = (service.name || '').toLowerCase();
    const slug = (service.slug || '').toLowerCase();
    const slugSpaced = slug.replace(/-/g, ' ');

    const serviceTokens = new Set(tokenize(`${name} ${slugSpaced}`));
    if (serviceTokens.size === 0) return 0;

    let score = 0;

    // Strong signals: explicit substring matches
    if (slug && normalizedMessage.includes(slug)) score += 60;
    if (slugSpaced && normalizedMessage.includes(slugSpaced)) score += 55;
    if (name && normalizedMessage.includes(name)) score += 50;

    // Token overlap
    let overlap = 0;
    for (const t of serviceTokens) {
      if (messageTokens.has(t)) overlap += 1;
    }

    score += overlap * 10;

    const coverage = overlap / Math.max(1, serviceTokens.size);
    if (coverage >= 0.7) score += 25;
    else if (coverage >= 0.5) score += 15;

    // Small boosts for common intents to reduce ambiguity
    if (/\bktp\b/i.test(message) && (name.includes('ktp') || slug.includes('ktp'))) score += 8;
    if (/\bpindah\b/i.test(message) && (name.includes('pindah') || slug.includes('pindah'))) score += 8;

    return score;
  };

  const best = services
    .map(s => ({ s, score: scoreService(s) }))
    .sort((a, b) => b.score - a.score)[0];

  // Guardrail against false positives: require a meaningful score.
  if (!best || best.score < 30) return null;
  return best.s.slug || null;
}

async function resolveServiceCandidatesForDisambiguation(
  villageId: string,
  message: string
): Promise<{ slug: string | null; candidates: Array<{ slug: string; name: string; score: number }> }> {
  const services = await getServiceCatalogForVillage(villageId);
  if (!services.length) return { slug: null, candidates: [] };

  const normalizedMessage = (message || '').toLowerCase();

  const stopwords = new Set([
    'syarat', 'persyaratan', 'berkas', 'dokumen', 'buat', 'bikin', 'pembuatan', 'mengurus', 'urus', 'minta', 'mohon',
    'cara', 'bagaimana', 'apa', 'saja', 'yang', 'untuk', 'dan', 'atau', 'dengan', 'dari', 'ke', 'di', 'pada', 'ini', 'itu',
    'kak', 'pak', 'bu', 'bapak', 'ibu', 'mas', 'mbak', 'saya', 'aku', 'kami', 'kita', 'tolong', 'bantu', 'online', 'form',
    'layanan', 'pelayanan', 'pengajuan', 'permohonan',
  ]);

  const tokenize = (text: string): string[] => {
    const cleaned = (text || '')
      .toLowerCase()
      .replace(/[^a-z0-9\s-]/g, ' ')
      .replace(/[-_]/g, ' ');

    return cleaned
      .split(/\s+/)
      .map(t => t.trim())
      .filter(Boolean)
      .filter(t => (t.length >= 3 || /^(kk|ktp|nik|npwp|akte)$/i.test(t)))
      .filter(t => !stopwords.has(t));
  };

  const messageTokens = new Set(tokenize(normalizedMessage));
  if (messageTokens.size === 0) return { slug: null, candidates: [] };

  const scoreService = (service: { name?: string; slug?: string }): number => {
    const name = (service.name || '').toLowerCase();
    const slug = (service.slug || '').toLowerCase();
    const slugSpaced = slug.replace(/-/g, ' ');

    const serviceTokens = new Set(tokenize(`${name} ${slugSpaced}`));
    if (serviceTokens.size === 0) return 0;

    let score = 0;
    if (slug && normalizedMessage.includes(slug)) score += 60;
    if (slugSpaced && normalizedMessage.includes(slugSpaced)) score += 55;
    if (name && normalizedMessage.includes(name)) score += 50;

    let overlap = 0;
    for (const t of serviceTokens) {
      if (messageTokens.has(t)) overlap += 1;
    }

    score += overlap * 10;
    const coverage = overlap / Math.max(1, serviceTokens.size);
    if (coverage >= 0.7) score += 25;
    else if (coverage >= 0.5) score += 15;

    if (/\bktp\b/i.test(message) && (name.includes('ktp') || slug.includes('ktp'))) score += 8;
    if (/\bpindah\b/i.test(message) && (name.includes('pindah') || slug.includes('pindah'))) score += 8;

    return score;
  };

  const scored = services
    .map(s => ({
      slug: String(s.slug || ''),
      name: String(s.name || ''),
      score: scoreService(s),
    }))
    .filter(x => x.slug && x.name)
    .sort((a, b) => b.score - a.score);

  const best = scored[0];
  if (!best || best.score < 30) return { slug: null, candidates: scored.slice(0, 3) };

  // Only keep meaningful candidates near the best score.
  const near = scored.filter(x => x.score >= 30 && best.score - x.score <= 12).slice(0, 3);
  if (near.length >= 2) {
    return { slug: null, candidates: near };
  }

  return { slug: best.slug, candidates: near.length ? near : [best] };
}

// Import action handlers from original orchestrator
import { 
  handleComplaintCreation,
  handleServiceInfo,
  handleServiceRequestCreation,
  handleStatusCheck,
  handleCancellation,
  handleComplaintUpdate,
  handleHistory,
  handleKnowledgeQuery,
  getPendingServiceFormOffer,
  clearPendingServiceFormOffer,
  isConfirmationResponse,
} from './ai-orchestrator.service';

// Import consolidated citizen data extraction
import { extractCitizenDataFromHistory } from './entity-extractor.service';

/**
 * Main 2-Layer processing function
 */
export async function processTwoLayerMessage(event: MessageReceivedEvent): Promise<void> {
  const startTime = Date.now(); // Track processing start time for analytics
  const { village_id, wa_user_id, message, message_id, has_media, media_url, media_public_url, media_type, is_batched, batched_message_ids } = event;
  
  // Validate required fields
  if (!wa_user_id || !message || !message_id) {
    logger.error('❌ Invalid message event - missing required fields', {
      hasWaUserId: !!wa_user_id,
      hasMessage: !!message,
      hasMessageId: !!message_id,
    });
    return;
  }
  
  logger.info('🎯 Processing 2-Layer message', {
    village_id,
    wa_user_id,
    message_id,
    messageLength: message.length,
    hasMedia: has_media,
    mediaType: media_type,
    isBatched: is_batched,
    batchCount: batched_message_ids?.length,
  });
  
  // Mark messages as read
  const messageIdsToRead = is_batched && batched_message_ids 
    ? batched_message_ids 
    : [message_id];
  
  markMessagesAsRead(wa_user_id, messageIdsToRead, village_id).catch((err) => {
    logger.warn('Failed to mark messages as read', { error: err.message });
  });
  
  // Notify processing status (for both single and batched messages)
  await publishMessageStatus({
    village_id,
    wa_user_id,
    message_ids: is_batched && batched_message_ids ? batched_message_ids : [message_id],
    status: 'processing',
  });
  
  try {
    // Step 0: Pre-checks
    const aiEnabled = await isAIChatbotEnabled();
    if (!aiEnabled) {
      logger.info('⏸️ AI chatbot is disabled, skipping message processing', { wa_user_id, message_id });
      await publishMessageStatus({
        village_id,
        wa_user_id,
        message_ids: is_batched && batched_message_ids ? batched_message_ids : [message_id],
        status: 'completed',
      });
      return;
    }
    
    const takeover = await isUserInTakeover(wa_user_id, village_id);
    if (takeover) {
      logger.info('👤 User is in takeover mode, admin will handle this message', { wa_user_id, message_id });
      await publishMessageStatus({
        village_id,
        wa_user_id,
        message_ids: is_batched && batched_message_ids ? batched_message_ids : [message_id],
        status: 'completed',
      });
      return;
    }
    
    // Step 0.1: Spam check
    cleanupPendingServiceDisambiguation();
    const hasPendingDisambiguation = pendingServiceDisambiguation.has(wa_user_id);
    const isDisambiguationChoice = /^\s*[1-3]\s*$/.test(message || '');
    if (isSpamMessage(message) && !(hasPendingDisambiguation && isDisambiguationChoice)) {
      logger.warn('🚫 Spam message detected, ignoring', {
        wa_user_id,
        message_id,
        messagePreview: message.substring(0, 50),
      });
      await publishMessageStatus({
        village_id,
        wa_user_id,
        message_ids: is_batched && batched_message_ids ? batched_message_ids : [message_id],
        status: 'completed',
      });
      return;
    }
    
    // Step 0.2: Input sanitization and basic typo correction
    let sanitizedMessage = sanitizeUserInput(message);
    sanitizedMessage = applyTypoCorrections(sanitizedMessage);
    
    logger.info('📝 Message preprocessed', {
      wa_user_id,
      originalLength: message.length,
      sanitizedLength: sanitizedMessage.length,
      typosCorrected: message !== sanitizedMessage,
    });
    
    // Step 0.3: Language and sentiment analysis
    detectLanguage(sanitizedMessage); // For logging purposes
    const sentiment = analyzeSentiment(sanitizedMessage, wa_user_id);
    
    if (needsHumanEscalation(wa_user_id)) {
      logger.warn('🚨 User needs human escalation', {
        wa_user_id,
        sentiment: sentiment.level,
        score: sentiment.score,
      });
    }
    
    // Step 1: Start typing indicator
    await startTyping(wa_user_id, village_id);

    const resolvedVillageId = village_id || process.env.DEFAULT_VILLAGE_ID;

    // Step 1.1: Pending online service form offer (2-step flow)
    const pendingOffer = getPendingServiceFormOffer(wa_user_id);
    if (pendingOffer) {
      const isNegative = /^(tidak|ga|gak|nggak|belum|nanti|skip|batal)\b/i.test(sanitizedMessage.trim());

      if (isConfirmationResponse(sanitizedMessage)) {
        clearPendingServiceFormOffer(wa_user_id);
        const llmLike = {
          intent: 'CREATE_SERVICE_REQUEST',
          fields: {
            service_slug: pendingOffer.service_slug,
            ...(pendingOffer.village_id || resolvedVillageId ? { village_id: pendingOffer.village_id || resolvedVillageId } : {}),
          },
          reply_text: '',
        };

        const reply = await handleServiceRequestCreation(wa_user_id, llmLike);
        await stopTyping(wa_user_id, village_id);
        await publishAIReply({
          village_id,
          wa_user_id,
          reply_text: validateResponse(reply),
          message_id: is_batched ? undefined : message_id,
          batched_message_ids: is_batched ? batched_message_ids : undefined,
        });
        await publishMessageStatus({
          village_id,
          wa_user_id,
          message_ids: is_batched && batched_message_ids ? batched_message_ids : [message_id],
          status: 'completed',
        });
        return;
      }

      if (isNegative) {
        clearPendingServiceFormOffer(wa_user_id);
        await stopTyping(wa_user_id, village_id);
        await publishAIReply({
          village_id,
          wa_user_id,
          reply_text: 'Baik Kak, siap. Kalau Kakak mau proses nanti, kabari saya ya. 😊',
          message_id: is_batched ? undefined : message_id,
          batched_message_ids: is_batched ? batched_message_ids : undefined,
        });
        await publishMessageStatus({
          village_id,
          wa_user_id,
          message_ids: is_batched && batched_message_ids ? batched_message_ids : [message_id],
          status: 'completed',
        });
        return;
      }

      await stopTyping(wa_user_id, village_id);
      await publishAIReply({
        village_id,
        wa_user_id,
        reply_text: 'Mau saya kirim link formulirnya sekarang? Balas *iya* atau *tidak* ya Kak.',
        message_id: is_batched ? undefined : message_id,
        batched_message_ids: is_batched ? batched_message_ids : undefined,
      });
      await publishMessageStatus({
        village_id,
        wa_user_id,
        message_ids: is_batched && batched_message_ids ? batched_message_ids : [message_id],
        status: 'completed',
      });
      return;
    }

    // Step 1.2: Deterministic village profile answers (avoid L2 hallucination)
    // Covers address/hours/contact questions using Dashboard profile data.
    const officeInfoPattern = /(alamat|lokasi|maps|google\s*maps|jam|operasional|buka|tutup|hari\s*kerja|kontak|hubungi|telepon|telp|call\s*center|hotline|\bnomor\b)/i;
    const trackingPattern = /(\b(LAP|LAY)-\d{8}-\d{3}\b)/i;
    if (officeInfoPattern.test(sanitizedMessage) && !trackingPattern.test(sanitizedMessage)) {
      const llmLike = {
        intent: 'KNOWLEDGE_QUERY',
        fields: {
          ...(resolvedVillageId ? { village_id: resolvedVillageId } : {}),
        },
        reply_text: '',
        guidance_text: '',
        needs_knowledge: true,
      };

      const deterministic = await handleKnowledgeQuery(wa_user_id, sanitizedMessage, llmLike);
      await stopTyping(wa_user_id, village_id);
      await publishAIReply({
        village_id,
        wa_user_id,
        reply_text: validateResponse(deterministic),
        message_id: is_batched ? undefined : message_id,
        batched_message_ids: is_batched ? batched_message_ids : undefined,
      });
      await publishMessageStatus({
        village_id,
        wa_user_id,
        message_ids: is_batched && batched_message_ids ? batched_message_ids : [message_id],
        status: 'completed',
      });
      return;
    }

    // Step 1.25: Resolve pending service disambiguation (if the user is picking a service)
    cleanupPendingServiceDisambiguation();
    const pending = pendingServiceDisambiguation.get(wa_user_id);
    if (pending && resolvedVillageId && pending.villageId === resolvedVillageId) {
      const trimmed = sanitizedMessage.trim();
      const choice = trimmed.match(/^([1-3])$/);
      const idx = choice ? Number(choice[1]) - 1 : -1;
      const picked = idx >= 0 ? pending.candidates[idx] : null;

      if (picked) {
        pendingServiceDisambiguation.delete(wa_user_id);
        const llmLike = {
          intent: 'SERVICE_INFO',
          fields: {
            village_id: resolvedVillageId,
            service_slug: picked.slug,
          },
          reply_text: '',
          guidance_text: '',
          needs_knowledge: false,
        };

        const deterministic = await handleServiceInfo(wa_user_id, llmLike);
        await stopTyping(wa_user_id, village_id);
        await publishAIReply({
          village_id,
          wa_user_id,
          reply_text: validateResponse(deterministic),
          message_id: is_batched ? undefined : message_id,
          batched_message_ids: is_batched ? batched_message_ids : undefined,
        });
        await publishMessageStatus({
          village_id,
          wa_user_id,
          message_ids: is_batched && batched_message_ids ? batched_message_ids : [message_id],
          status: 'completed',
        });
        return;
      }

      // If pending exists but user didn't answer with 1-3, let it fall through.
    }

    // Step 1.3: Deterministic service requirements lookup (avoid L2 hallucination)
    // If user asks "syarat/persyaratan" for common services (e.g., KTP), resolve the service from
    // case-service catalog and answer via database (handleServiceInfo).
    const wantsRequirements = /(syarat|persyaratan|berkas|dokumen)\b/i.test(sanitizedMessage);
    if (wantsRequirements && resolvedVillageId) {
      const resolved = await resolveServiceCandidatesForDisambiguation(resolvedVillageId, sanitizedMessage);
      if (resolved.slug) {
        const llmLike = {
          intent: 'SERVICE_INFO',
          fields: {
            village_id: resolvedVillageId,
            service_slug: resolved.slug,
          },
          reply_text: '',
          guidance_text: '',
          needs_knowledge: false,
        };

        const deterministic = await handleServiceInfo(wa_user_id, llmLike);
        await stopTyping(wa_user_id, village_id);
        await publishAIReply({
          village_id,
          wa_user_id,
          reply_text: validateResponse(deterministic),
          message_id: is_batched ? undefined : message_id,
          batched_message_ids: is_batched ? batched_message_ids : undefined,
        });
        await publishMessageStatus({
          village_id,
          wa_user_id,
          message_ids: is_batched && batched_message_ids ? batched_message_ids : [message_id],
          status: 'completed',
        });
        return;
      }

      if (resolved.candidates.length >= 2) {
        const candidates = resolved.candidates
          .slice(0, 3)
          .map(c => ({ slug: c.slug, name: c.name }));

        pendingServiceDisambiguation.set(wa_user_id, {
          villageId: resolvedVillageId,
          candidates,
          timestamp: Date.now(),
        });

        const lines = candidates.map((c, i) => `${i + 1}. ${c.name}`).join('\n');
        const prompt = `Saya menemukan beberapa layanan yang mirip. Kakak maksud yang mana ya?\n\n${lines}\n\nBalas angka *1–${candidates.length}*.`;

        await stopTyping(wa_user_id, village_id);
        await publishAIReply({
          village_id,
          wa_user_id,
          reply_text: validateResponse(prompt),
          message_id: is_batched ? undefined : message_id,
          batched_message_ids: is_batched ? batched_message_ids : undefined,
        });
        await publishMessageStatus({
          village_id,
          wa_user_id,
          message_ids: is_batched && batched_message_ids ? batched_message_ids : [message_id],
          status: 'completed',
        });
        return;
      }
    }

    // Step 1.4: Deterministic history command
    // Avoid L2 responding with meta-instructions like "ketik riwayat" when the user already did.
    if (/^(riwayat|history)$/i.test(sanitizedMessage.trim())) {
      const reply = await handleHistory(wa_user_id);
      await stopTyping(wa_user_id, village_id);
      await publishAIReply({
        village_id,
        wa_user_id,
        reply_text: validateResponse(reply),
        message_id: is_batched ? undefined : message_id,
        batched_message_ids: is_batched ? batched_message_ids : undefined,
      });
      await publishMessageStatus({
        village_id,
        wa_user_id,
        message_ids: is_batched && batched_message_ids ? batched_message_ids : [message_id],
        status: 'completed',
      });
      return;
    }

    // Step 1.5: Deterministic DETAIL mode (shows richer info if requested)
    const ticketInText = sanitizedMessage.match(/\b(LAY|LAP)-\d{8}-\d{3,}\b/i);
    const wantsDetail = /\b(detail|rinci|lengkap)\b/i.test(sanitizedMessage);
    if (wantsDetail && ticketInText) {
      const ticket = ticketInText[0].toUpperCase();
      const llmLike = {
        intent: 'CHECK_STATUS',
        fields: ticket.startsWith('LAP-')
          ? { complaint_id: ticket, detail_mode: true }
          : { request_number: ticket, detail_mode: true },
        reply_text: '',
        guidance_text: '',
        needs_knowledge: false,
      };

      const reply = await handleStatusCheck(wa_user_id, llmLike);
      await stopTyping(wa_user_id, village_id);
      await publishAIReply({
        village_id,
        wa_user_id,
        reply_text: validateResponse(reply),
        message_id: is_batched ? undefined : message_id,
        batched_message_ids: is_batched ? batched_message_ids : undefined,
      });
      await publishMessageStatus({
        village_id,
        wa_user_id,
        message_ids: is_batched && batched_message_ids ? batched_message_ids : [message_id],
        status: 'completed',
      });
      return;
    }

    // Step 1.6: Deterministic "detail terakhir/terbaru" (no ticket provided)
    const wantsDetailLatest = wantsDetail && /\b(terakhir|terbaru|paling\s*baru)\b/i.test(sanitizedMessage);
    if (wantsDetailLatest && !ticketInText) {
      const history = await getUserHistory(wa_user_id);
      if (!history?.combined?.length) {
        const reply = `📋 *Riwayat Anda*\n\nBelum ada laporan atau layanan.\nKetik pesan untuk memulai.`;
        await stopTyping(wa_user_id, village_id);
        await publishAIReply({
          village_id,
          wa_user_id,
          reply_text: validateResponse(reply),
          message_id: is_batched ? undefined : message_id,
          batched_message_ids: is_batched ? batched_message_ids : undefined,
        });
        await publishMessageStatus({
          village_id,
          wa_user_id,
          message_ids: is_batched && batched_message_ids ? batched_message_ids : [message_id],
          status: 'completed',
        });
        return;
      }

      const latest = [...history.combined]
        .map(item => {
          const updatedAt = item.updated_at ? Date.parse(item.updated_at) : NaN;
          const createdAt = item.created_at ? Date.parse(item.created_at) : NaN;
          const ts = !isNaN(updatedAt) ? updatedAt : !isNaN(createdAt) ? createdAt : 0;
          return { item, ts };
        })
        .sort((a, b) => b.ts - a.ts)[0]?.item;

      const ticket = (latest?.display_id || '').toUpperCase();
      if (!ticket) {
        const reply = `Maaf Kak, saya tidak menemukan nomor laporan/layanan terbaru di riwayat.`;
        await stopTyping(wa_user_id, village_id);
        await publishAIReply({
          village_id,
          wa_user_id,
          reply_text: validateResponse(reply),
          message_id: is_batched ? undefined : message_id,
          batched_message_ids: is_batched ? batched_message_ids : undefined,
        });
        await publishMessageStatus({
          village_id,
          wa_user_id,
          message_ids: is_batched && batched_message_ids ? batched_message_ids : [message_id],
          status: 'completed',
        });
        return;
      }

      const llmLike = {
        intent: 'CHECK_STATUS',
        fields: ticket.startsWith('LAP-')
          ? { complaint_id: ticket, detail_mode: true }
          : { request_number: ticket, detail_mode: true },
        reply_text: '',
        guidance_text: '',
        needs_knowledge: false,
      };

      const reply = await handleStatusCheck(wa_user_id, llmLike);
      await stopTyping(wa_user_id, village_id);
      await publishAIReply({
        village_id,
        wa_user_id,
        reply_text: validateResponse(reply),
        message_id: is_batched ? undefined : message_id,
        batched_message_ids: is_batched ? batched_message_ids : undefined,
      });
      await publishMessageStatus({
        village_id,
        wa_user_id,
        message_ids: is_batched && batched_message_ids ? batched_message_ids : [message_id],
        status: 'completed',
      });
      return;
    }

    // Step 1.6: Deterministic CHECK_STATUS (command + ticket)
    // Ensure grounded status lookup even if L1/L2 drift.
    const looksLikeStatusCommand = /\b(cek\s*status|status)\b/i.test(sanitizedMessage);
    if (looksLikeStatusCommand && ticketInText) {
      const ticket = ticketInText[0].toUpperCase();
      const llmLike = {
        intent: 'CHECK_STATUS',
        fields: ticket.startsWith('LAP-')
          ? { complaint_id: ticket }
          : { request_number: ticket },
        reply_text: '',
        guidance_text: '',
        needs_knowledge: false,
      };

      const reply = await handleStatusCheck(wa_user_id, llmLike);
      await stopTyping(wa_user_id, village_id);
      await publishAIReply({
        village_id,
        wa_user_id,
        reply_text: validateResponse(reply),
        message_id: is_batched ? undefined : message_id,
        batched_message_ids: is_batched ? batched_message_ids : undefined,
      });
      await publishMessageStatus({
        village_id,
        wa_user_id,
        message_ids: is_batched && batched_message_ids ? batched_message_ids : [message_id],
        status: 'completed',
      });
      return;
    }

    // Step 1.7: Deterministic status/detail by ticket number
    // Users often reply with the number shown in riwayat (e.g., "LAY-20260128-001").
    // Route it to CHECK_STATUS deterministically to avoid L2 off-topic replies.
    const directTicket = sanitizedMessage.trim().match(/^(LAY|LAP)-\d{8}-\d{3,}$/i);
    if (directTicket) {
      const ticket = directTicket[0].toUpperCase();
      const llmLike = {
        intent: 'CHECK_STATUS',
        fields: ticket.startsWith('LAP-')
          ? { complaint_id: ticket }
          : { request_number: ticket },
        reply_text: '',
        guidance_text: '',
        needs_knowledge: false,
      };

      const reply = await handleStatusCheck(wa_user_id, llmLike);
      await stopTyping(wa_user_id, village_id);
      await publishAIReply({
        village_id,
        wa_user_id,
        reply_text: validateResponse(reply),
        message_id: is_batched ? undefined : message_id,
        batched_message_ids: is_batched ? batched_message_ids : undefined,
      });
      await publishMessageStatus({
        village_id,
        wa_user_id,
        message_ids: is_batched && batched_message_ids ? batched_message_ids : [message_id],
        status: 'completed',
      });
      return;
    }
    
    // Step 2: PRE-EXTRACTION - Extract entities before Layer 1
    logger.info('🔍 Pre-extracting entities', { wa_user_id });
    const conversationHistory = await getConversationHistory(wa_user_id, village_id);
    const { extractAllEntities } = await import('./entity-extractor.service');
    const preExtractedEntities = extractAllEntities(sanitizedMessage, conversationHistory);
    
    logger.debug('Pre-extraction completed', {
      wa_user_id,
      extractedCount: preExtractedEntities.extractedCount,
      confidence: preExtractedEntities.confidence,
    });
    
    // Step 3: LAYER 1 - Intent & Understanding (with pre-extracted data)
    logger.info('🔍 Starting Layer 1 - Intent & Understanding', { wa_user_id });
    
    const layer1Input = {
      message: sanitizedMessage,
      wa_user_id,
      conversation_history: conversationHistory,
      pre_extracted_data: preExtractedEntities.entities,
    };
    
    const layer1Output = await callLayer1LLM(layer1Input);
    
    if (!layer1Output) {
      logger.error('❌ Layer 1 failed completely', { wa_user_id });
      await stopTyping(wa_user_id);
      throw new Error('Layer 1 LLM failure - all models exhausted');
    }
    
    logger.info('✅ Layer 1 completed', {
      wa_user_id,
      intent: layer1Output.intent,
      confidence: layer1Output.confidence,
      extractedDataKeys: Object.keys(layer1Output.extracted_data),
      needsClarification: layer1Output.needs_clarification.length,
    });
    
    // Step 4: Data validation and enhancement
    const enhancedLayer1Output = await enhanceLayer1Output(layer1Output, wa_user_id);
    
    // Step 5: LAYER 2 - Response Generation
    logger.info('💬 Starting Layer 2 - Response Generation', { wa_user_id });

    // Knowledge prefetch (so Layer 2 can answer hours/info safely)
    let knowledgeContext = '';
    try {
      const villageId = village_id || process.env.DEFAULT_VILLAGE_ID;
      const isGreeting = /^(halo|hai|hi|hello|selamat\s+(pagi|siang|sore|malam)|assalamualaikum|permisi)/i.test(sanitizedMessage.trim());
      const looksLikeQuestion = shouldRetrieveContext(sanitizedMessage);

      if (isGreeting) {
        const info = await getKelurahanInfoContext(villageId);
        if (info && info.trim()) {
          knowledgeContext = `KNOWLEDGE BASE YANG TERSEDIA:\n${info}`;
        }
      } else if (looksLikeQuestion) {
        const rag = await getRAGContext(sanitizedMessage, undefined, villageId);
        if (rag?.totalResults > 0 && rag.contextString) {
          knowledgeContext = `KNOWLEDGE BASE YANG TERSEDIA:\n${rag.contextString}`;
        }
      }
    } catch (error: any) {
      logger.warn('⚠️ 2-layer knowledge prefetch failed', { wa_user_id, error: error.message });
    }
    
    const layer2Input = {
      layer1_output: enhancedLayer1Output,
      wa_user_id,
      conversation_context: [
        await getConversationContext(wa_user_id, village_id),
        knowledgeContext,
      ].filter(Boolean).join('\n\n'),
      user_name: enhancedLayer1Output.extracted_data.nama_lengkap,
    };
    
    const initialLayer2Output = await callLayer2LLM(layer2Input);
    if (!initialLayer2Output) {
      logger.warn('⚠️ Layer 2 failed, using fallback', { wa_user_id });
    }

    // Always ensure Layer 2 output is non-null for the rest of the flow
    let ensuredLayer2Output: Layer2Output = initialLayer2Output ?? generateFallbackResponse(enhancedLayer1Output);

    // Anti-hallucination gate: if no knowledge and response mentions hours/cost, retry once
    const gate = needsAntiHallucinationRetry({
      replyText: ensuredLayer2Output.reply_text,
      guidanceText: ensuredLayer2Output.guidance_text,
      hasKnowledge: !!knowledgeContext,
    });
    if (gate.shouldRetry) {
      logAntiHallucinationEvent({
        userId: wa_user_id,
        channel: 'whatsapp',
        reason: gate.reason,
      });

      const retryInput = {
        ...layer2Input,
        conversation_context: appendAntiHallucinationInstruction(layer2Input.conversation_context || ''),
      };
      const retry = await callLayer2LLM(retryInput);
      if (retry?.reply_text) {
        ensuredLayer2Output = retry;
      }
    }
    
    logger.info('✅ Layer 2 completed', {
      wa_user_id,
      replyLength: ensuredLayer2Output.reply_text.length,
      hasGuidance: !!ensuredLayer2Output.guidance_text,
      nextAction: ensuredLayer2Output.next_action,
      confidence: ensuredLayer2Output.confidence,
    });
    
    // Step 6: Stop typing indicator
    await stopTyping(wa_user_id, village_id);
    
    // Step 7: Handle actions based on intent
    let finalReplyText = ensuredLayer2Output.reply_text;
    let guidanceText = ensuredLayer2Output.guidance_text || '';
    
    if (ensuredLayer2Output.next_action && enhancedLayer1Output.confidence >= 0.7) {
      finalReplyText = await handleAction(
        ensuredLayer2Output.next_action,
        enhancedLayer1Output,
        ensuredLayer2Output,
        village_id,
        wa_user_id,
        sanitizedMessage,
        media_public_url || media_url
      );
    }
    
    // Step 8: Validate and sanitize final response
    finalReplyText = validateResponse(finalReplyText);
    if (guidanceText) {
      guidanceText = validateResponse(guidanceText);
    }
    
    // Step 9: Record analytics
    const processingDurationMs = Date.now() - startTime;
    aiAnalyticsService.recordIntent(
      wa_user_id,
      enhancedLayer1Output.intent,
      processingDurationMs,
      sanitizedMessage.length,
      finalReplyText.length,
      'two-layer-architecture'
    );
    
    // Step 10: Publish AI reply
    await publishAIReply({
      village_id,
      wa_user_id,
      reply_text: finalReplyText,
      guidance_text: guidanceText || undefined,
      message_id: is_batched ? undefined : message_id,
      batched_message_ids: is_batched ? batched_message_ids : undefined,
    });
    
    // Mark as completed (for both single and batched messages)
    await publishMessageStatus({
      village_id,
      wa_user_id,
      message_ids: is_batched && batched_message_ids ? batched_message_ids : [message_id],
      status: 'completed',
    });
    
    logger.info('✅ 2-Layer message processed successfully', {
      wa_user_id,
      message_id,
      intent: enhancedLayer1Output.intent,
      layer1Confidence: enhancedLayer1Output.confidence,
      layer2Confidence: ensuredLayer2Output.confidence,
      hasGuidance: !!guidanceText,
      isBatched: is_batched,
    });
    
  } catch (error: any) {
    await stopTyping(wa_user_id, village_id);
    
    logger.error('❌ Failed to process 2-layer message', {
      wa_user_id,
      message_id,
      error: error.message,
      isBatched: is_batched,
    });
    
    // Add to retry queue
    const { addToAIRetryQueue } = await import('./rabbitmq.service');
    addToAIRetryQueue(event, error.message || 'Unknown error');
    
    // Mark as failed (for both single and batched messages)
    await publishMessageStatus({
      village_id,
      wa_user_id,
      message_ids: is_batched && batched_message_ids ? batched_message_ids : [message_id],
      status: 'failed',
      error_message: error.message,
    });
  }
}

/**
 * Enhance Layer 1 output with additional data extraction from history
 */
async function enhanceLayer1Output(layer1Output: Layer1Output, wa_user_id: string): Promise<Layer1Output> {
  // ALWAYS try to enhance with history data for better multi-step conversation support
  logger.info('🔍 Enhancing Layer 1 output with history data', { 
    wa_user_id, 
    originalConfidence: layer1Output.confidence,
    needsClarification: layer1Output.needs_clarification.length,
  });
  
  try {
    // Extract citizen data from conversation history (using consolidated function)
    const historyData = await extractCitizenDataFromHistory(wa_user_id, { limit: 20 });
    
    if (historyData) {
      // Merge history data with Layer 1 extracted data (history data fills gaps)
      const enhanced = { ...layer1Output };
      const originalData = enhanced.extracted_data;
      
      // Smart merge: only use history data if Layer 1 didn't extract it or extracted it poorly
      for (const [key, value] of Object.entries(historyData)) {
        const currentValue = originalData[key as keyof typeof originalData];
        
        // Use history data if:
        // 1. Current value is empty/null/undefined
        // 2. Current value is very short (< 3 chars) and history value is longer
        // 3. For specific fields that are commonly missed by Layer 1
        const shouldUseHistoryValue = 
          !currentValue || 
          currentValue === '' ||
          (typeof currentValue === 'string' && currentValue.length < 3 && value && value.toString().length > currentValue.length) ||
          (key === 'alamat' && (!currentValue || currentValue.length < 5) && value && value.toString().length >= 5);
        
        if (shouldUseHistoryValue && value) {
          (enhanced.extracted_data as any)[key] = value;
          logger.info(`✅ Enhanced ${key} from history`, {
            wa_user_id,
            original: currentValue,
            enhanced: value,
          });
        }
      }
      
      // Recalculate confidence based on data completeness and quality
      const originalDataKeys = Object.keys(originalData).filter(key => {
        const value = originalData[key as keyof typeof originalData];
        return value !== undefined && value !== null && value !== '';
      });
      
      const enhancedDataKeys = Object.keys(enhanced.extracted_data).filter(key => {
        const value = enhanced.extracted_data[key as keyof typeof enhanced.extracted_data];
        return value !== undefined && value !== null && value !== '';
      });
      
      // Boost confidence if we added meaningful data
      if (enhancedDataKeys.length > originalDataKeys.length) {
        const confidenceBoost = Math.min(0.3, (enhancedDataKeys.length - originalDataKeys.length) * 0.1);
        enhanced.confidence = Math.min(0.95, enhanced.confidence + confidenceBoost);
        enhanced.processing_notes += ` | Enhanced with ${enhancedDataKeys.length - originalDataKeys.length} fields from history`;
      }
      
      // Update needs_clarification based on enhanced data
      const updatedClarifications = enhanced.needs_clarification.filter(field => {
        const enhancedValue = enhanced.extracted_data[field as keyof typeof enhanced.extracted_data];
        return !enhancedValue || enhancedValue === '';
      });
      enhanced.needs_clarification = updatedClarifications;
      
      logger.info('✅ Layer 1 output enhanced', {
        wa_user_id,
        originalDataKeys: originalDataKeys.length,
        enhancedDataKeys: enhancedDataKeys.length,
        originalConfidence: layer1Output.confidence,
        newConfidence: enhanced.confidence,
        clarificationsReduced: layer1Output.needs_clarification.length - enhanced.needs_clarification.length,
        remainingClarifications: enhanced.needs_clarification,
      });
      
      return enhanced;
    } else {
      logger.info('No history data found for enhancement', { wa_user_id });
    }
  } catch (error: any) {
    logger.warn('Failed to enhance Layer 1 output', { wa_user_id, error: error.message });
  }
  
  return layer1Output;
}



/**
 * Handle actions based on intent
 */
async function handleAction(
  action: string,
  layer1Output: Layer1Output,
  layer2Output: Layer2Output,
  village_id: string | undefined,
  wa_user_id: string,
  message: string,
  mediaUrl?: string
): Promise<string> {
  
  logger.info('🎬 Handling action', { wa_user_id, action, intent: layer1Output.intent });
  
  try {
    // Create mock LLM response format for compatibility with existing handlers
    const mockLlmResponse = {
      intent: layer1Output.intent,
      fields: {
        ...layer1Output.extracted_data,
        village_id: village_id || (layer1Output.extracted_data as any)?.village_id || process.env.DEFAULT_VILLAGE_ID,
      },
      reply_text: layer2Output.reply_text,
      guidance_text: layer2Output.guidance_text,
      needs_knowledge: layer2Output.needs_knowledge,
    };
    
    switch (action) {
      case 'CREATE_COMPLAINT':
        return await handleComplaintCreation(wa_user_id, mockLlmResponse, message, mediaUrl);
      
      case 'SERVICE_INFO':
        return await handleServiceInfo(wa_user_id, mockLlmResponse);
      
      case 'CREATE_SERVICE_REQUEST':
        return await handleServiceRequestCreation(wa_user_id, mockLlmResponse);

      case 'UPDATE_COMPLAINT':
        return await handleComplaintUpdate(wa_user_id, mockLlmResponse);
      
      case 'CHECK_STATUS':
        return await handleStatusCheck(wa_user_id, mockLlmResponse);
      
      case 'CANCEL_COMPLAINT':
        return await handleCancellation(wa_user_id, mockLlmResponse);
      
      case 'HISTORY':
        return await handleHistory(wa_user_id);
      
      case 'KNOWLEDGE_QUERY':
        return await handleKnowledgeQuery(wa_user_id, message, mockLlmResponse);
      
      default:
        logger.info('No specific action handler, using Layer 2 response', { wa_user_id, action });
        return layer2Output.reply_text;
    }
  } catch (error: any) {
    logger.error('Action handler failed', { wa_user_id, action, error: error.message });
    return layer2Output.reply_text; // Fallback to Layer 2 response
  }
}

/**
 * Get conversation history for Layer 1 context
 */
async function getConversationHistory(wa_user_id: string, village_id?: string): Promise<string> {
  try {
    const axios = (await import('axios')).default;
    const { config } = await import('../config/env');
    
    const url = `${config.channelServiceUrl}/internal/messages`;
    const response = await axios.get(url, {
      params: { wa_user_id, limit: 5, ...(village_id ? { village_id } : {}) },
      headers: { 'x-internal-api-key': config.internalApiKey },
      timeout: 3000,
    });
    
    const messages = response.data?.messages || [];
    return messages
      .filter((m: any) => m.direction === 'IN')
      .map((m: any) => m.message_text)
      .join(' | ');
  } catch (error) {
    return '';
  }
}

/**
 * Get conversation context for Layer 2
 */
async function getConversationContext(wa_user_id: string, village_id?: string): Promise<string> {
  try {
    const axios = (await import('axios')).default;
    const { config } = await import('../config/env');
    
    const url = `${config.channelServiceUrl}/internal/messages`;
    const response = await axios.get(url, {
      params: { wa_user_id, limit: 3, ...(village_id ? { village_id } : {}) },
      headers: { 'x-internal-api-key': config.internalApiKey },
      timeout: 3000,
    });
    
    const messages = response.data?.messages || [];
    return messages
      .map((m: any) => `${m.direction === 'IN' ? 'User' : 'Gana'}: ${m.message_text}`)
      .join('\n');
  } catch (error) {
    return 'Percakapan baru';
  }
}

/**
 * Validate response (imported from original orchestrator)
 */
function validateResponse(response: string): string {
  if (!response || response.trim().length === 0) {
    return 'Ada yang bisa saya bantu lagi?';
  }
  
  let cleaned = response;
  
  // Ensure response isn't too long
  if (cleaned.length > 4000) {
    cleaned = cleaned.substring(0, 3950) + '...\n\nPesan terpotong karena terlalu panjang.';
  }
  
  // Remove code artifacts
  if (cleaned.includes('```') || cleaned.includes('{\"')) {
    logger.warn('Response contains code artifacts, cleaning...');
    cleaned = cleaned.replace(/```[\s\S]*?```/g, '');
    cleaned = cleaned.replace(/\{\"[\s\S]*?\}/g, '');
    cleaned = cleaned.trim();
    
    if (cleaned.length < 10) {
      return 'Maaf, terjadi kesalahan. Silakan ulangi pertanyaan Anda.';
    }
  }
  
  return cleaned;
}