import logger from '../utils/logger';
import { isContactDirectoryLookup } from './important-contacts.service';
import type { ProcessMessageResult } from './ump-types';

const DAY_LABELS: Record<string, string> = {
  senin: 'Senin', selasa: 'Selasa', rabu: 'Rabu', kamis: 'Kamis',
  jumat: 'Jumat', sabtu: 'Sabtu', minggu: 'Minggu',
};
const DAY_ORDER = ['senin', 'selasa', 'rabu', 'kamis', 'jumat', 'sabtu', 'minggu'];

function formatOperatingHoursForResident(hours: any): string {
  if (!hours) return '';
  if (typeof hours === 'string') return hours.trim();
  if (typeof hours !== 'object') return '';
  const lines = DAY_ORDER
    .filter((day) => (hours as any)[day])
    .map((day) => {
      const h = (hours as any)[day];
      if (!h?.open && !h?.close) return `- ${DAY_LABELS[day]}: libur`;
      return `- ${DAY_LABELS[day]}: ${h.open || '?'} - ${h.close || '?'}`;
    });
  return lines.join('\n');
}

export type AnswerPolicyKind =
  | 'structured_fact_contact'
  | 'structured_fact_service_listing'
  | 'structured_fact_service_detail'
  | 'structured_fact_village_profile'
  | 'structured_fact_other'
  | 'transactional_update'
  | 'knowledge_answer'
  | 'clarification'
  | 'handoff'
  | 'passthrough';

export interface AnswerPolicyDecision {
  kind: AnswerPolicyKind;
  /** True when the caller should accept the current result as-is. */
  ok: boolean;
  /** True when the result was rewritten for safety. */
  rewritten: boolean;
  /** Short machine-readable reason. */
  reason: string;
  /** Optional replacement result. If present, caller should use it. */
  replacement?: ProcessMessageResult;
}

interface VerifyInput {
  userMessage: string;
  /** The result we are about to send. */
  result: ProcessMessageResult;
  /** Tools actually executed in this turn (may be empty). */
  toolsUsed: string[];
  /** True if this message went through a deterministic pre-agent guard. */
  handledByGuard: boolean;
  /** Resident's village, used to self-heal village-profile answers from DB. */
  villageId?: string;
}

const CONTACT_GROUNDING_TOOLS = new Set([
  'get_important_contact',
  'get_emergency_contacts',
  'get_village_profile',
]);

const CONTACT_GROUNDING_SOURCE_KINDS = new Set([
  'contact_directory_lookup',
  'official_emergency_contacts',
  'official_village_profile',
]);

const VILLAGE_PROFILE_GROUNDING_TOOLS = new Set([
  'get_village_profile',
]);

const VILLAGE_PROFILE_GROUNDING_SOURCE_KINDS = new Set([
  'official_village_profile',
]);

const SERVICE_DETAIL_GROUNDING_TOOLS = new Set([
  'get_service_info',
  'create_service_request',
]);

const SERVICE_DETAIL_GROUNDING_SOURCE_KINDS = new Set([
  'official_service_info',
]);

const KNOWLEDGE_GROUNDING_TOOLS = new Set([
  'search_knowledge',
  'search_documents',
]);

const KNOWLEDGE_GROUNDING_SOURCE_KINDS = new Set([
  'knowledge_retrieval',
  'document_retrieval',
]);

const SERVICE_LISTING_QUERY_PATTERNS = [
  /^\s*(apa\s+(aja|saja)\s+(layanan|pelayanan|surat)(\s+desa)?|layanan\s+(desa|yang\s+ada)|pelayanan\s+desa\s+apa\s+(aja|saja)|list\s+layanan|daftar\s+layanan|bisa\s+(urus|ngurus|mengurus|diurus)\s+apa\s+(aja|saja)(\s+di\s+(sini|desa))?)\s*\??\s*$/i,
  /\b(layanan|pelayanan|surat(?:\s+menyurat)?)(?:\s+desa)?\s+(apa|apa\s+(aja|saja)|yang\s+(ada|tersedia)|tersedia|bisa\s+(diurus|dilayani))\b/i,
];

const VILLAGE_PROFILE_QUERY_PATTERNS = [
  /\b(jam\s+(buka|kerja|operasional|pelayanan|tutup)|kapan\s+(buka|tutup)|buka\s+jam|tutup\s+jam)\b/i,
  /\b(alamat|lokasi|dimana|dmna|dmn)\s+(kantor|desa|kelurahan|balai|kelurahan)\b/i,
  /\b(alamat\s+(kantor|desa|kelurahan)|kantor\s+desa\s+dimana)\b/i,
  /\b(google\s*maps?|maps?\s+(desa|kantor))\b/i,
  // Bare/pronoun address questions ("alamatnya di mana?", "lokasinya dimana") —
  // common as a follow-up where the office is already the topic.
  /\b(alamat|lokasi)(nya|\s+nya)?\s*(di\s*)?(mana|dimana|dmna|dmn)\b/i,
];

const SERVICE_DETAIL_QUERY_PATTERNS = [
  /\b(syarat|persyaratan|ketentuan|berkas|dokumen\s+(untuk|yg|yang))\b.*\b(ktp|kk|akta|akte|sktm|skck|domisili|pindah|nikah|kematian|kelahiran|usaha|iumk|imb|umkm)\b/i,
  /\b(ktp|kk|akta|akte|sktm|skck|domisili|pindah|nikah|kematian|kelahiran|usaha|iumk|imb|umkm)\b.*\b(syarat|persyaratan|berkas|dokumen|biaya|tarif|harga|gratis|bayar|prosedur|cara|proses|alur|langkah)\b/i,
  /\b(biaya|tarif|harga|berapa)\b.*\b(ktp|kk|akta|akte|sktm|skck|domisili|pindah|nikah|kematian|kelahiran|layanan|surat)\b/i,
  /\b(cara|prosedur|proses|alur|langkah)\b.*\b(buat|bikin|urus|daftar|ajukan)\b.*\b(ktp|kk|akta|akte|sktm|skck|domisili|pindah|nikah|kematian|kelahiran|surat)\b/i,
];

function asksForVillageProfile(message: string): boolean {
  const normalized = (message || '').toLowerCase().trim();
  if (!normalized) return false;
  return VILLAGE_PROFILE_QUERY_PATTERNS.some((pattern) => pattern.test(normalized));
}

function asksForServiceDetail(message: string): boolean {
  const normalized = (message || '').toLowerCase().trim();
  if (!normalized) return false;
  return SERVICE_DETAIL_QUERY_PATTERNS.some((pattern) => pattern.test(normalized));
}

function asksForServiceListing(message: string): boolean {
  const normalized = (message || '').toLowerCase().trim();
  if (!normalized) return false;
  if (/\b(ktp|kk|akta|domisili|sktm|pindah|kematian|kelahiran|nikah)\b/.test(normalized)) {
    return false;
  }
  return SERVICE_LISTING_QUERY_PATTERNS.some((pattern) => pattern.test(normalized));
}

function looksLikePhoneNumber(text: string): boolean {
  return /\b(?:0\d{2,3}[-.\s]?\d{3,4}[-.\s]?\d{3,4}|\+?62\s?\d{2,3}[-.\s]?\d{3,4}[-.\s]?\d{3,4}|08\d{8,11}|\(0\d{2,3}\)\s?\d{6,8})\b/.test(text);
}

function isExplicitUncertaintyReply(text: string): boolean {
  const normalized = (text || '').toLowerCase().trim();
  if (!normalized) return true;

  return [
    /\b(maaf|mohon maaf)\b.*\b(belum bisa memastikan|belum dapat memastikan|belum bisa saya pastikan|belum dapat saya pastikan|belum menemukan|belum tersedia|tidak bisa memastikan|tidak dapat memastikan)\b/i,
    /\b(saya cek dulu|saya bantu cek dulu|perlu saya cek dulu|sebaiknya saya cek dulu|coba tanyakan lagi|sebentar ya)\b/i,
    /\b(mohon sebutkan layanan|mohon sebutkan nama layanannya|silakan sebutkan layanan)\b/i,
  ].some((pattern) => pattern.test(normalized));
}

function mentionsServiceFactClaim(text: string): boolean {
  return /\b(syarat|persyaratan|berkas|dokumen|biaya(?:nya)?|tarif(?:nya)?|harga(?:nya)?|gratis|rp\s*\d|prosedur|cara|proses|alur|langkah|hari kerja|online|offline|formulir|link formulir|tersedia|belum tersedia|tidak tersedia|bisa diajukan|tidak bisa diajukan|harus ke kantor|datang ke kantor)\b/i.test(text);
}

function mentionsVillageProfileFactClaim(text: string): boolean {
  return /\b\d{1,2}[:.]\d{2}\b/.test(text)
    || /\b(senin|selasa|rabu|kamis|jumat|sabtu|minggu|operasional|hari kerja)\b/i.test(text)
    || /\b(jl\.|jalan|rt\s*\d|rw\s*\d|berada di|terletak di|google maps|gmaps|telepon kantor|nomor kantor)\b/i.test(text)
    // Administrative-region claims — a fabricated kecamatan/kabupaten/provinsi is
    // the exact failure we must catch ("Kec. Galut, Kab. Takalar" vs real data).
    || /\b(kecamatan|kabupaten|provinsi|kec\.|kab\.|prov\.)\s+\w/i.test(text);
}

function mentionsStructuredFactClaim(text: string): boolean {
  return looksLikePhoneNumber(text)
    || mentionsServiceFactClaim(text)
    || mentionsVillageProfileFactClaim(text);
}

function classify(message: string, result: ProcessMessageResult): AnswerPolicyKind {
  const intent = result.intent;

  if (intent === 'CONTACT_DIRECTORY') return 'structured_fact_contact';
  if (intent === 'EMERGENCY_CONTACTS') return 'structured_fact_contact';
  if (intent === 'CREATE_COMPLAINT' || intent === 'CREATE_SERVICE_REQUEST') {
    return 'transactional_update';
  }
  if (intent === 'CHECK_STATUS') return 'transactional_update';

  if (isContactDirectoryLookup(message)) return 'structured_fact_contact';
  if (asksForServiceListing(message)) return 'structured_fact_service_listing';
  if (asksForServiceDetail(message)) return 'structured_fact_service_detail';
  if (asksForVillageProfile(message)) return 'structured_fact_village_profile';

  if (intent === 'VILLAGE_PROFILE') return 'structured_fact_village_profile';
  if (intent === 'SERVICE_INFO') return 'structured_fact_service_detail';
  if (intent === 'KNOWLEDGE_QUERY' || intent === 'DOCUMENT_SEARCH') {
    return 'knowledge_answer';
  }
  if (intent === 'QUESTION' || intent === 'MEMORY_LOOKUP') {
    return 'knowledge_answer';
  }

  return 'passthrough';
}

function buildContactFallback(message: string, traceId: string, startTime: number): ProcessMessageResult {
  return {
    success: true,
    response: 'Maaf Pak/Bu, saya belum menemukan nomor yang cocok untuk permintaan tersebut di daftar kontak desa.\n\nKalau mau, sebutkan nama atau jabatan yang lebih spesifik ya (misalnya "kepala desa", "puskesmas", "damkar").',
    intent: 'CONTACT_DIRECTORY',
    metadata: {
      processingTimeMs: Date.now() - startTime,
      hasKnowledge: false,
      agentMode: 'answer_policy_verifier',
      traceId,
      guardrail: {
        stage: 'answer_policy',
        type: 'contact_directory_ungrounded',
        action: 'rewritten',
        reason: 'no_contact_tool_used',
      },
    },
  };
}

function buildServiceListingFallback(traceId: string, startTime: number): ProcessMessageResult {
  return {
    success: true,
    response: 'Maaf Pak/Bu, daftar layanan lengkap sedang tidak bisa saya tampilkan sekarang. Coba sebentar lagi, atau sebutkan langsung keperluannya (misalnya KTP, surat domisili, SKTM) — nanti saya bantu detailkan ya.',
    intent: 'SERVICE_INFO',
    metadata: {
      processingTimeMs: Date.now() - startTime,
      hasKnowledge: false,
      agentMode: 'answer_policy_verifier',
      traceId,
      guardrail: {
        stage: 'answer_policy',
        type: 'service_listing_ungrounded',
        action: 'rewritten',
        reason: 'no_service_tool_used',
      },
    },
  };
}

function buildServiceDetailFallback(userMessage: string, traceId: string, startTime: number): ProcessMessageResult {
  const svcHint = userMessage.match(/\b(ktp|kk|akta|akte|sktm|skck|domisili|pindah|nikah|kematian|kelahiran|iumk|imb|umkm)\b/i)?.[1] || '';
  const targetSvc = svcHint ? ` untuk *${svcHint.toUpperCase()}*` : '';
  return {
    success: true,
    response: `Maaf Pak/Bu, detail syarat${targetSvc} belum bisa saya pastikan dari data resmi desa. Mohon sebutkan layanan yang dimaksud dengan lebih spesifik, atau saya bantu cek langsung di katalog layanan desa ya.`,
    intent: 'SERVICE_INFO',
    metadata: {
      processingTimeMs: Date.now() - startTime,
      hasKnowledge: false,
      agentMode: 'answer_policy_verifier',
      traceId,
      guardrail: {
        stage: 'answer_policy',
        type: 'service_detail_ungrounded',
        action: 'rewritten',
        reason: 'no_service_tool_used',
      },
    },
  };
}

async function buildVillageProfileFallback(
  userMessage: string,
  villageId: string | undefined,
  traceId: string,
  startTime: number,
): Promise<ProcessMessageResult> {
  const profile = villageId
    ? await import('./knowledge.service')
        .then((m) => m.getVillageProfileSummary(villageId))
        .catch(() => null)
    : null;
  const normalized = (userMessage || '').toLowerCase();
  const wantsHours = /\b(jam|buka|tutup|kerja|operasional|pelayanan|kapan)\b/i.test(normalized);
  const wantsAddress = /\b(alamat|lokasi|dimana|dmna|dmn|maps?)\b/i.test(normalized);

  if (profile) {
    const segments: string[] = [];
    const hoursText = formatOperatingHoursForResident(profile.operating_hours);
    if ((wantsHours || !wantsAddress) && hoursText) {
      segments.push(`Jam buka Kantor Desa ${profile.name || ''}`.trim() + `:\n${hoursText}`);
    }
    if ((wantsAddress || !wantsHours)) {
      if (profile.address) segments.push(`Alamat: ${profile.address}`);
      if (profile.gmaps_url) segments.push(`Google Maps: ${profile.gmaps_url}`);
    }
    if (segments.length > 0) {
      return {
        success: true,
        response: segments.join('\n\n'),
        intent: 'VILLAGE_PROFILE',
        metadata: {
          processingTimeMs: Date.now() - startTime,
          hasKnowledge: true,
          agentMode: 'answer_policy_verifier',
          traceId,
          guardrail: {
            stage: 'answer_policy',
            type: 'village_profile_ungrounded',
            action: 'rewritten_self_healed',
            reason: 'no_village_profile_tool_used',
          },
        },
      };
    }
  }

  return {
    success: true,
    response: 'Maaf Pak/Bu, untuk alamat dan jam buka kantor desa sebaiknya saya cek dulu dari data resmi agar tidak keliru. Coba tanyakan lagi sebentar ya.',
    intent: 'VILLAGE_PROFILE',
    metadata: {
      processingTimeMs: Date.now() - startTime,
      hasKnowledge: false,
      agentMode: 'answer_policy_verifier',
      traceId,
      guardrail: {
        stage: 'answer_policy',
        type: 'village_profile_ungrounded',
        action: 'rewritten',
        reason: 'no_village_profile_tool_used',
      },
    },
  };
}

function buildKnowledgeFallback(traceId: string, startTime: number): ProcessMessageResult {
  return {
    success: true,
    response: 'Maaf Pak/Bu, saya belum menemukan informasi yang cukup akurat dari data desa untuk menjawab itu. Bisa sebutkan detail yang ingin dicek, misalnya nama layanan, nomor laporan, atau topik dokumennya?',
    intent: 'KNOWLEDGE_QUERY',
    metadata: {
      processingTimeMs: Date.now() - startTime,
      hasKnowledge: false,
      agentMode: 'answer_policy_verifier',
      traceId,
      guardrail: {
        stage: 'answer_policy',
        type: 'knowledge_ungrounded',
        action: 'rewritten',
        reason: 'knowledge_answer_without_retrieval_grounding',
      },
    },
  };
}

function hasTrustedGrounding(
  result: ProcessMessageResult,
  toolsUsed: string[],
  allowedTools: Set<string>,
  allowedSourceKinds: Set<string>,
): boolean {
  const toolTrace = Array.isArray(result.metadata?.toolTrace) ? result.metadata.toolTrace : [];
  const groundedByTrace = toolTrace.some((trace) => {
    if (!trace.success) return false;
    if (trace.trustLevel !== 'trusted_fact' && trace.trustLevel !== 'trusted_record') {
      return false;
    }
    return allowedTools.has(trace.tool) || (!!trace.sourceKind && allowedSourceKinds.has(trace.sourceKind));
  });
  if (groundedByTrace) return true;

  const grounding = result.metadata?.grounding;
  if (grounding?.trustedTools?.some((tool) => allowedTools.has(tool))) {
    return true;
  }
  if (grounding?.sourceKinds?.some((sourceKind) => allowedSourceKinds.has(sourceKind))) {
    return true;
  }

  // Legacy fallback only: a tool name alone is not enough when trace data says
  // it failed or returned weak/empty retrieval. This prevents failed tools from
  // being counted as authoritative grounding.
  if (toolTrace.length > 0) return false;
  return toolsUsed.some((tool) => allowedTools.has(tool));
}

function hasReliableRetrievalGrounding(
  result: ProcessMessageResult,
  toolsUsed: string[],
): boolean {
  const allowedTools = KNOWLEDGE_GROUNDING_TOOLS;
  const allowedSourceKinds = KNOWLEDGE_GROUNDING_SOURCE_KINDS;
  const toolTrace = Array.isArray(result.metadata?.toolTrace) ? result.metadata.toolTrace : [];

  const groundedByTrace = toolTrace.some((trace) => {
    if (!trace.success) return false;
    if (trace.trustLevel !== 'untrusted_retrieval') return false;
    if (!allowedTools.has(trace.tool) && !(trace.sourceKind && allowedSourceKinds.has(trace.sourceKind))) return false;
    if (trace.found === false) return false;
    const confidence = String(trace.confidenceLevel || '').toLowerCase();
    return confidence !== 'low' && confidence !== 'none';
  });
  if (groundedByTrace) return true;

  if (toolTrace.length > 0) return false;
  return toolsUsed.some((tool) => allowedTools.has(tool));
}

/**
 * Main entry: verify an outgoing result against the answer policy.
 */
export async function verifyAnswer(input: VerifyInput): Promise<AnswerPolicyDecision> {
  const { userMessage, result, toolsUsed, handledByGuard, villageId } = input;
  const kind = classify(userMessage, result);
  const responseText = `${result.response || ''}\n${result.guidanceText || ''}`;
  const traceId = result.metadata?.traceId || 'unknown';
  const startTime = Date.now() - (result.metadata?.processingTimeMs || 0);
  const asksContact = isContactDirectoryLookup(userMessage);
  const asksServiceDetail = asksForServiceDetail(userMessage);
  const asksVillageProfile = asksForVillageProfile(userMessage);
  const mentionsPhone = looksLikePhoneNumber(responseText);
  const usedContactTool = hasTrustedGrounding(result, toolsUsed, CONTACT_GROUNDING_TOOLS, CONTACT_GROUNDING_SOURCE_KINDS);
  const usedServiceTool = hasTrustedGrounding(result, toolsUsed, SERVICE_DETAIL_GROUNDING_TOOLS, SERVICE_DETAIL_GROUNDING_SOURCE_KINDS);
  const usedProfileTool = hasTrustedGrounding(result, toolsUsed, VILLAGE_PROFILE_GROUNDING_TOOLS, VILLAGE_PROFILE_GROUNDING_SOURCE_KINDS);

  if (handledByGuard) {
    return { kind, ok: true, rewritten: false, reason: 'guard_prevalidated' };
  }

  if (asksContact && mentionsPhone && !usedContactTool) {
    logger.warn('🛡️ answer-policy: rejecting mixed or direct contact claim without grounding', {
      traceId: result.metadata?.traceId,
      toolsUsed,
      intent: result.intent,
    });
    return {
      kind: 'structured_fact_contact',
      ok: false,
      rewritten: true,
      reason: 'contact_number_without_tool',
      replacement: buildContactFallback(userMessage, traceId, startTime),
    };
  }

  if (asksServiceDetail && mentionsServiceFactClaim(responseText) && !usedServiceTool) {
    logger.warn('answer-policy: rejecting mixed or direct service detail without grounding', {
      traceId: result.metadata?.traceId,
      toolsUsed,
      intent: result.intent,
    });
    return {
      kind: 'structured_fact_service_detail',
      ok: false,
      rewritten: true,
      reason: 'service_detail_without_tool',
      replacement: buildServiceDetailFallback(userMessage, traceId, startTime),
    };
  }

  if (asksVillageProfile && mentionsVillageProfileFactClaim(responseText) && !usedProfileTool) {
    logger.warn('answer-policy: rejecting mixed or direct village profile without grounding', {
      traceId: result.metadata?.traceId,
      toolsUsed,
      intent: result.intent,
    });
    return {
      kind: 'structured_fact_village_profile',
      ok: false,
      rewritten: true,
      reason: 'village_profile_without_tool',
      replacement: await buildVillageProfileFallback(userMessage, villageId, traceId, startTime),
    };
  }

  if (kind === 'structured_fact_contact') {
    if (usedContactTool) {
      return { kind, ok: true, rewritten: false, reason: 'grounded_via_contact_tool' };
    }

    if (mentionsPhone) {
      logger.warn('🛡️ answer-policy: rejecting ungrounded contact response', {
        traceId: result.metadata?.traceId,
        toolsUsed,
        intent: result.intent,
      });
      return {
        kind,
        ok: false,
        rewritten: true,
        reason: 'contact_number_without_tool',
        replacement: buildContactFallback(userMessage, traceId, startTime),
      };
    }

    if (asksContact) {
      return {
        kind,
        ok: false,
        rewritten: true,
        reason: 'contact_directory_without_grounding',
        replacement: buildContactFallback(userMessage, traceId, startTime),
      };
    }

    return { kind, ok: true, rewritten: false, reason: 'no_phone_no_grounding_needed' };
  }

  if (kind === 'structured_fact_service_listing') {
    const usedServiceTool = hasTrustedGrounding(result, toolsUsed, new Set(['get_service_info']), SERVICE_DETAIL_GROUNDING_SOURCE_KINDS);
    if (usedServiceTool) {
      return { kind, ok: true, rewritten: false, reason: 'grounded_via_service_tool' };
    }

    if (isExplicitUncertaintyReply(responseText)) {
      return { kind, ok: true, rewritten: false, reason: 'explicit_uncertainty_without_service_tool' };
    }

    logger.warn('🛡️ answer-policy: rejecting ungrounded service listing', {
      traceId: result.metadata?.traceId,
      toolsUsed,
    });
    return {
      kind,
      ok: false,
      rewritten: true,
      reason: 'service_listing_without_tool',
      replacement: buildServiceListingFallback(
        result.metadata?.traceId || 'unknown',
        Date.now() - (result.metadata?.processingTimeMs || 0),
      ),
    };
  }

  if (kind === 'structured_fact_service_detail') {
    const usedServiceTool = hasTrustedGrounding(result, toolsUsed, SERVICE_DETAIL_GROUNDING_TOOLS, SERVICE_DETAIL_GROUNDING_SOURCE_KINDS);
    if (usedServiceTool) {
      return { kind, ok: true, rewritten: false, reason: 'grounded_via_service_tool' };
    }

    if (isExplicitUncertaintyReply(responseText) && !mentionsServiceFactClaim(responseText)) {
      return { kind, ok: true, rewritten: false, reason: 'explicit_uncertainty_without_service_tool' };
    }

    logger.warn('answer-policy: rejecting ungrounded service detail', {
      traceId: result.metadata?.traceId,
      toolsUsed,
    });
    return {
      kind,
      ok: false,
      rewritten: true,
      reason: 'service_detail_without_tool',
      replacement: buildServiceDetailFallback(
        userMessage,
        result.metadata?.traceId || 'unknown',
        Date.now() - (result.metadata?.processingTimeMs || 0),
      ),
    };
  }

  if (kind === 'structured_fact_village_profile') {
    const usedProfileTool = hasTrustedGrounding(result, toolsUsed, VILLAGE_PROFILE_GROUNDING_TOOLS, VILLAGE_PROFILE_GROUNDING_SOURCE_KINDS);
    if (usedProfileTool) {
      return { kind, ok: true, rewritten: false, reason: 'grounded_via_profile_tool' };
    }

    if (isExplicitUncertaintyReply(responseText) && !mentionsVillageProfileFactClaim(responseText)) {
      return { kind, ok: true, rewritten: false, reason: 'explicit_uncertainty_without_profile_tool' };
    }

    logger.warn('answer-policy: rejecting ungrounded village profile', {
      traceId: result.metadata?.traceId,
      toolsUsed,
    });
    return {
      kind,
      ok: false,
      rewritten: true,
      reason: 'village_profile_without_tool',
      replacement: await buildVillageProfileFallback(
        userMessage,
        villageId,
        result.metadata?.traceId || 'unknown',
        Date.now() - (result.metadata?.processingTimeMs || 0),
      ),
    };
  }

  if (kind === 'knowledge_answer') {
    const usedKnowledgeTool = hasReliableRetrievalGrounding(result, toolsUsed);
    const usedStructuredTool = usedContactTool || usedServiceTool || usedProfileTool;

    if (usedKnowledgeTool || usedStructuredTool || isExplicitUncertaintyReply(responseText)) {
      return { kind, ok: true, rewritten: false, reason: 'knowledge_answer_grounded_or_uncertain' };
    }

    if (mentionsStructuredFactClaim(responseText)) {
      logger.warn('answer-policy: rejecting ungrounded knowledge answer with structured fact claim', {
        traceId: result.metadata?.traceId,
        toolsUsed,
        intent: result.intent,
      });
      return {
        kind,
        ok: false,
        rewritten: true,
        reason: 'knowledge_structured_fact_without_grounding',
        replacement: buildKnowledgeFallback(traceId, startTime),
      };
    }
  }

  return { kind, ok: true, rewritten: false, reason: 'passthrough' };
}
