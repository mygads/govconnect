import {
  cancelComplaint,
  cancelServiceRequest,
  getServiceCatalog,
  getUserHistory,
} from './case-client.service';
import { updateConversationUserProfile } from './channel-client.service';
import { rememberMemoryEvent } from './hybrid-memory.service';
import { handleCancellationRequest, handleComplaintCreation, handlePendingAddressConfirmation } from './complaint-handler';
import { classifyConfirmation } from './confirmation-classifier.service';
import type { UnifiedClassifyResult } from './micro-llm-matcher.service';
import { handleServiceRequestCreation, handleServiceRequestEditLink } from './service-handler';
import { handleStatusCheck } from './status-handler';
import {
  buildCancelErrorResponse,
  buildCancelSuccessResponse,
  buildImportantContactsMessage,
  buildChannelParams,
  toVCardContacts,
} from './ump-formatters';
import { ProcessMessageResult, normalizeHandlerResult } from './ump-types';
import {
  MAX_PHOTOS_PER_COMPLAINT,
  addPendingPhoto,
  clearActiveServiceInfo,
  clearPendingAddressRequest,
  clearPendingCancelConfirmation,
  clearPendingComplaintData,
  clearPendingEmergencyComplaintOffer,
  clearPendingServiceClarification,
  clearPendingServiceFormOffer,
  getActiveServiceInfoWithFallback,
  getPendingServiceClarificationWithFallback,
  getPendingAddressConfirmationWithFallback,
  getPendingAddressRequestWithFallback,
  getPendingCancelConfirmationWithFallback,
  getPendingComplaintDataWithFallback,
  getPendingEmergencyComplaintOfferWithFallback,
  getPendingPhotoCount,
  getPendingServiceFormOfferWithFallback,
  setActiveServiceInfo,
  setPendingAddressRequest,
  setPendingComplaintData,
  setPendingEmergencyComplaintOffer,
  setPendingServiceClarification,
  setPendingServiceFormOffer,
  syncNameToChannelService,
  type ActiveServiceInfoState,
  type PendingServiceClarificationAlternativeState,
  type PendingServiceClarificationState,
} from './ump-state';
import {
  appendToHistoryCache,
  fetchConversationHistoryFromChannel,
} from './ump-utils';
import { getAutoFillSuggestionsWithFallback, updateProfile } from './user-profile.service';
import { getImportantContacts, isContactDirectoryLookup, lookupImportantContacts } from './important-contacts.service';
import logger from '../utils/logger';

type MicroBudgetRunner = <T>(task: () => Promise<T>, fallback: T) => Promise<T>;
type TrackerLike = {
  preparing(): void;
  complete(): void;
};

export type RoutingAction = 'handle_pre_agent' | 'defer_to_agent' | 'release_state_and_defer' | 'hard_block';
export type RoutingConfidence = 'hard' | 'high' | 'medium' | 'low';
export type FastIntentPrimary =
  | 'status_lookup'
  | 'service_info'
  | 'service_listing'
  | 'service_follow_up'
  | 'service_clarification'
  | 'service_form_confirmation'
  | 'complaint_creation'
  | 'complaint_resume'
  | 'contact_lookup'
  | 'emergency_contact'
  | 'out_of_scope'
  | 'knowledge_query'
  | 'greeting'
  | 'unknown';

export interface FastIntentDecision {
  action: RoutingAction;
  confidence: RoutingConfidence;
  primaryIntent: FastIntentPrimary;
  mixedSignals: boolean;
  stateAffinity?: 'answers_pending_state' | 'switches_topic' | 'unclear';
  reasons: string[];
  allowedToolHints?: string[];
}

export type PreAgentRouteResult =
  | { kind: 'handled'; result: ProcessMessageResult }
  | { kind: 'defer'; reason: string }
  | { kind: 'release_and_defer'; reason: string; releasedState: string[] };

function buildGuardResult(input: {
  startTime: number;
  traceId: string;
  response: string;
  guidanceText?: string;
  intent: string;
  hasKnowledge?: boolean;
  contacts?: ProcessMessageResult['contacts'];
  guardrail?: NonNullable<ProcessMessageResult['metadata']['guardrail']>;
  routing?: FastIntentDecision;
}): ProcessMessageResult {
  return {
    success: true,
    response: input.response,
    guidanceText: input.guidanceText,
    contacts: input.contacts,
    intent: input.intent,
    metadata: {
      processingTimeMs: Date.now() - input.startTime,
      hasKnowledge: input.hasKnowledge ?? false,
      agentMode: 'pre_agent_guard',
      traceId: input.traceId,
      ...(input.guardrail ? { guardrail: input.guardrail } : {}),
      ...(input.routing ? { routing: input.routing } : {}),
    },
  };
}

function toConfirmationDecision(result: { decision?: string } | null | undefined): 'yes' | 'no' | 'uncertain' {
  if (result?.decision === 'CONFIRM') return 'yes';
  if (result?.decision === 'REJECT') return 'no';
  return 'uncertain';
}

function detectServiceCorrectionReply(message: string): boolean {
  const normalized = (message || '').toLowerCase();
  if (!/\b(salah|bukan|maksud(?:nya)?|harusnya|yang benar|ganti|ubah)\b/i.test(normalized)) {
    return false;
  }
  return SERVICE_ADMIN_PATTERN.test(normalized) || SERVICE_EVENT_PATTERN.test(normalized);
}

function detectExplicitConfirmationReply(message: string): 'yes' | 'no' | 'uncertain' {
  const normalized = (message || '')
    .trim()
    .toLowerCase()
    .replace(/[!?.;,]/g, ' ')
    .replace(/\s+/g, ' ');

  if (!normalized) return 'uncertain';

  const explicitYesPatterns = [
    /^(ya|iya|y|yes|oke|ok|siap|lanjut|setuju|betul|benar)$/i,
    /^(ya|iya|yes)\s+(lanjut|boleh|setuju|batalkan|proses|silakan)$/i,
    /^(oke|ok|siap)\s+(ya|iya|lanjut|batalkan)$/i,
    /^boleh(\s+ya)?$/i,
  ];

  const explicitNoPatterns = [
    /^(tidak|nggak|ga|gak|tdk|no|batal|jangan)$/i,
    /^(tidak|nggak|ga|gak)\s+(jadi|dulu|usah|perlu)$/i,
    /^(batal|jangan)\s+(saja|dulu|ya)$/i,
    /^gak jadi$/i,
    /^nanti(\s+dulu)?$/i,
    /^(terima\s+kasih|makasih|oke\s+makasih|ok\s+makasih|siap\s+makasih)$/i,
  ];

  if (explicitYesPatterns.some((pattern) => pattern.test(normalized))) {
    return 'yes';
  }

  if (explicitNoPatterns.some((pattern) => pattern.test(normalized))) {
    return 'no';
  }

  return 'uncertain';
}

// Keyword-only patterns are kept narrow. Broader intent is asserted by
// combining these keywords with an ACTIVE-EVENT signal below.
// Audit (2026-05-10): previously a bare "polisi" or "banjir" was enough to
// route to emergency/complaint; this misrouted asks like "nomor polsek",
// "program edukasi sampah", or "nomor KTP hilang".
const COMPLAINT_INCIDENT_KEYWORDS = /\b(jalan rusak|jalan berlubang|lampu mati|sampah menumpuk|sampah berserakan|drainase|selokan mampet|banjir|pohon tumbang|fasilitas rusak|aspal rusak|jalan licin|jalan amblas|kecelaka+an|kebakaran|orang pingsan|ledakan)\b/i;
const COMPLAINT_INFO_QUERY_PATTERN = /\b(pengaduan|keluhan|laporan)\b/i;
const COMPLAINT_INFO_HINT_PATTERN = /\b(apa|bagaimana|gimana|jelaskan|contoh|format|prioritas|checklist|sop|panduan|prosedur|alur|status)\b/i;
const SERVICE_ADMIN_PATTERN = /\b(surat|ktp|kk|akta|domisili|sktm|layanan|permohonan|pengantar)\b/i;
const EMERGENCY_KEYWORDS = /\b(kebakaran|damkar|pemadam|ambulans|ambulan|orang sakit keras|kecelakaan|pencurian|darurat|bencana|longsor|gempa|tsunami|evakuasi|ledakan)\b/i;

/** Active-event signal: user is *reporting* something happening now. */
const ACTIVE_EVENT_SIGNAL = /\b(tolong|segera|help|help\s*me|bantu|bantuin|terjadi|sedang\s+terjadi|barusan|baru\s+saja|lagi|ada\s+(?:yang|yg)|di\s*sini\s+ada|telah\s+terjadi|baru\s+terjadi|kejadian|ya\s*allah|ya\s*tuhan|astaga|gawat|bahaya)\b/i;

/** Explicit "I want to report" — this alone is enough to enter complaint flow. */
const EXPLICIT_REPORT_PATTERN = /\b(ingin lapor|mau lapor|saya lapor|saya mau lapor|buat laporan|buat pengaduan|laporkan|aduan)\b/i;

/** Directory lookup — user asking FOR a number, not reporting an emergency. */
const CONTACT_DIRECTORY_SIGNAL = /\b(nomor|no\.?|nomer|kontak|telp|telpon|telepon|hp|wa|whatsapp)\b/i;

/** Information/query signal — user is asking ABOUT, not reporting. */
const INFORMATION_QUERY_SIGNAL = /\b(apa|apakah|bagaimana|gimana|kenapa|kapan|dimana|di\s*mana|berapa|siapa|program|edukasi|sosialisasi|penjelasan|jelaskan|pengertian|definisi|maksud|arti)\b/i;

/**
 * Complaint incident detection with guard-rails against false positives.
 * Returns true ONLY when keywords co-occur with an active-event signal OR
 * an explicit-report phrase. "Program edukasi sampah" will NOT trigger.
 */
function matchesComplaintIncident(normalized: string): boolean {
  if (EXPLICIT_REPORT_PATTERN.test(normalized)) return true;
  if (!COMPLAINT_INCIDENT_KEYWORDS.test(normalized)) return false;
  // Guard: if the query is clearly informational, it's a knowledge question.
  if (INFORMATION_QUERY_SIGNAL.test(normalized) && !ACTIVE_EVENT_SIGNAL.test(normalized)) {
    return false;
  }
  // Guard: if the user is asking for a contact number, not reporting.
  if (CONTACT_DIRECTORY_SIGNAL.test(normalized)) return false;
  return ACTIVE_EVENT_SIGNAL.test(normalized);
}

/**
 * Emergency detection. Requires either explicit active-event signal OR
 * kebakaran/ledakan (which are rarely casual conversation). "Nomor polisi"
 * or "program damkar sekolah" will NOT trigger.
 */
function matchesActiveEmergency(normalized: string): boolean {
  // Contact lookup intent overrides emergency — "ada nomor damkar?" is not
  // an active fire, it's a directory query.
  if (CONTACT_DIRECTORY_SIGNAL.test(normalized)) return false;
  // Pure information queries about emergency topics aren't emergencies.
  if (INFORMATION_QUERY_SIGNAL.test(normalized) && !ACTIVE_EVENT_SIGNAL.test(normalized)) {
    return false;
  }
  if (!EMERGENCY_KEYWORDS.test(normalized)) return false;
  // Rare severe-event keywords carry enough signal by themselves.
  if (/\b(kebakaran|ledakan|gempa|tsunami|longsor)\b/i.test(normalized)) return true;
  return ACTIVE_EVENT_SIGNAL.test(normalized);
}

/** Legacy aliases retained so existing call-sites keep working. */
const COMPLAINT_INCIDENT_PATTERN = {
  test: (s: string) => matchesComplaintIncident(s),
};
const EMERGENCY_PATTERN = {
  test: (s: string) => matchesActiveEmergency(s),
};
const SERVICE_EVENT_PATTERN = /\b(meninggal|kematian|lahir|kelahiran|pindah|nikah|cerai|ktp|kk|domisili|akta|sktm|surat)\b/i;
const OUT_OF_SCOPE_PUBLIC_SERVICE_PATTERN = /\b(sim|paspor|bpjs|visa|imigrasi|npwp|stnk|bpkb)\b/i;
// Narrow, high-confidence out-of-scope signals. Keywords here must be
// essentially unambiguous signs of programming or entertainment chatter.
// We deliberately avoid loose Indonesian words like "program" (could mean
// "program bantuan/pkh"), "film" (could mean "film desa"), "rumus" (could
// mean "rumus perhitungan pajak"), etc.
const OUT_OF_SCOPE_GENERAL_PATTERN = /\b(javascript|typescript|\bpython\b|\bjava\s+script\b|ngoding|console\.log|for\s*\(|while\s*\(|algoritma|zodiak|horoskop|tarot|cocokologi)\b/i;
const OUT_OF_SCOPE_STRONG_SIGNALS = [
  // Entertainment request explicit
  /\b(rekomendasi|rekomendasiin|bahas)\s+(film|anime|drama|game|lagu|artis)\b/i,
  // Programming help explicit
  /\b(bantu|ajari?|tolong)\s+(ngoding|coding|nulis\s+code|debug|bikin\s+program)\b/i,
  /\b(cara|gimana)\s+(ngoding|coding|bikin\s+(program|script|aplikasi)\s+(javascript|python|java|typescript))\b/i,
  // Math tutoring explicit
  /\b(kerjain|bantu|tolong)\s+(soal|pr|tugas)\s+(matematika|fisika|kimia)\b/i,
  /^\s*\d+\s*[+\-*/x]\s*\d+\s*(?:=\s*)?\s*(?:\?|berapa|hasil|sama dengan|result|ya)?[\s?.]*$/i,
];
const SERVICE_INFORMATIONAL_LINK_PATTERN = /\b(ada\s+(link|tautan|form|formulir)(?:nya)?|(link|tautan|form|formulir)(?:nya)?\s+ada|link\s+online|form\s+online|tautan\s+online)\b/i;
const SERVICE_EXPLICIT_ACTION_PATTERN = /\b((kirim(?:kan)?|tolong kirim|minta|mana)\s+(link|tautan|form|formulir)(?:nya)?|(link|tautan|form|formulir)(?:nya)?\s+(mana|sekarang|saja)|lanjut(?:kan)?\s+(ajukan|pengajuan|permohonan)|ajukan(?:kan)?\s+(layanan|permohonan|pengajuan)|buat(?:kan)?\s+(pengajuan|permohonan)|isi\s+formulir)\b/i;
const SERVICE_PENDING_INFO_PATTERN = /\b(syarat(?:nya)?|persyaratan(?:nya)?|biaya(?:nya)?|berapa lama|lama proses(?:nya)?|proses(?:nya)?|dokumen(?:nya)?|berkas(?:nya)?|harus ke kantor|ke kantor|offline|online|link(?:nya)?|form(?:nya)?)\b/i;
const GOVCONNECT_USAGE_PATTERN = /\b(govconnect|whatsapp|webchat|lay-|lap-|cek status|riwayat|pengaduan|layanan desa|kantor desa)\b/i;
const VILLAGE_SERVICE_SCOPE_PATTERN = /\b(surat|ktp|kk|akta|domisili|sktm|layanan|permohonan|pengaduan|laporan|status|kantor desa|jam buka|kontak|darurat)\b/i;
const VILLAGE_PROFILE_TOPIC_PATTERN = /\b(jam\s+(buka|kerja|operasional|pelayanan|tutup)|kapan\s+(buka|tutup)|alamat\s+(kantor|desa|kelurahan)|kantor\s+desa|lokasi\s+(kantor|desa)|maps?|google\s*maps?)\b/i;
const STATUS_CANCEL_EDIT_TOPIC_PATTERN = /\b(cek\s+status|status\s+(laporan|layanan|pengajuan|permohonan)|riwayat|history|batal|batalkan|cancel|edit\s+layanan|ubah\s+data|update\s+data|perbarui\s+data)\b/i;
const CORRECTION_TOPIC_SHIFT_PATTERN = /\b(bukan\s+itu|maksud\s+saya|maksudnya|ganti\s+topik|sebentar|nanti\s+dulu)\b/i;

function isOutOfScopeGeneralQuestion(message: string): boolean {
  const normalized = (message || '').toLowerCase();
  if (/\b(lap|lay)-\d{8}-\d{3}\b/i.test(message)) return false;
  if (GOVCONNECT_USAGE_PATTERN.test(normalized) || VILLAGE_SERVICE_SCOPE_PATTERN.test(normalized)) return false;
  if (OUT_OF_SCOPE_GENERAL_PATTERN.test(normalized)) return true;
  return OUT_OF_SCOPE_STRONG_SIGNALS.some((pattern) => pattern.test(normalized));
}

function isPendingServiceFollowUp(message: string): boolean {
  return SERVICE_PENDING_INFO_PATTERN.test((message || '').toLowerCase());
}

function isExplicitServiceActionRequest(message: string): boolean {
  return SERVICE_EXPLICIT_ACTION_PATTERN.test((message || '').toLowerCase());
}

function isInformationalServiceLinkInquiry(message: string): boolean {
  if (isExplicitServiceActionRequest(message)) {
    return false;
  }
  return SERVICE_INFORMATIONAL_LINK_PATTERN.test((message || '').toLowerCase());
}

function isPendingServiceLinkRequest(message: string): boolean {
  return isExplicitServiceActionRequest(message) || isInformationalServiceLinkInquiry(message);
}

function isClearlyDifferentIntent(message: string): boolean {
  const normalized = (message || '').toLowerCase();
  if (!normalized) return false;
  if (isContactDirectoryLookup(message)) return true;
  if (VILLAGE_PROFILE_TOPIC_PATTERN.test(normalized)) return true;
  if (STATUS_CANCEL_EDIT_TOPIC_PATTERN.test(normalized)) return true;
  if (CORRECTION_TOPIC_SHIFT_PATTERN.test(normalized)) return true;
  return /\b(mau lapor|ingin lapor|buat laporan|buat pengaduan|lapor jalan|lampu mati|sampah|darurat|kebakaran|kecelaka+an|pohon tumbang)\b/i.test(normalized);
}

function buildRoutingDecision(input: Partial<FastIntentDecision> & Pick<FastIntentDecision, 'primaryIntent'>): FastIntentDecision {
  return {
    action: input.action || 'defer_to_agent',
    confidence: input.confidence || 'low',
    primaryIntent: input.primaryIntent,
    mixedSignals: input.mixedSignals ?? false,
    ...(input.stateAffinity ? { stateAffinity: input.stateAffinity } : {}),
    reasons: input.reasons || [],
    ...(input.allowedToolHints ? { allowedToolHints: input.allowedToolHints } : {}),
  };
}

export function decideFastIntent(input: {
  message: string;
  hasPendingServiceOffer?: boolean;
  hasPendingEmergencyOffer?: boolean;
  hasPendingServiceClarification?: boolean;
  hasActiveServiceInfo?: boolean;
  hasPendingComplaintState?: boolean;
  unified?: UnifiedClassifyResult | null;
}): FastIntentDecision {
  const normalized = (input.message || '').toLowerCase().trim();
  const stateActive = !!(input.hasPendingServiceOffer || input.hasPendingServiceClarification || input.hasActiveServiceInfo || input.hasPendingComplaintState);
  const serviceSignal = SERVICE_ADMIN_PATTERN.test(normalized) || isServiceListingQuery(normalized) || isPendingServiceFollowUp(normalized);
  const contactSignal = isContactDirectoryLookup(input.message);
  const complaintSignal = COMPLAINT_INCIDENT_PATTERN.test(normalized) || EXPLICIT_REPORT_PATTERN.test(normalized);
  const emergencySignal = EMERGENCY_PATTERN.test(normalized) && !contactSignal;
  const villageProfileSignal = VILLAGE_PROFILE_TOPIC_PATTERN.test(normalized);
  const outOfScopeSignal = OUT_OF_SCOPE_PUBLIC_SERVICE_PATTERN.test(normalized) || isOutOfScopeGeneralQuestion(normalized);
  const signalCount = [serviceSignal, contactSignal, complaintSignal, emergencySignal, villageProfileSignal, outOfScopeSignal].filter(Boolean).length;
  const mixedSignals = signalCount > 1;

  if (/^(halo|hai|hi|assalamualaikum|permisi|terima kasih|makasih)[\s!.,?]*$/i.test(normalized)) {
    return buildRoutingDecision({ primaryIntent: 'greeting', action: 'defer_to_agent', confidence: 'high', reasons: ['greeting_or_thanks'] });
  }

  if ((input.hasPendingServiceOffer || input.hasPendingServiceClarification) && contactSignal) {
    return buildRoutingDecision({
      primaryIntent: 'contact_lookup',
      action: 'release_state_and_defer',
      confidence: 'high',
      mixedSignals,
      stateAffinity: 'switches_topic',
      reasons: ['pending_state_contact_topic_shift'],
      allowedToolHints: ['get_important_contact'],
    });
  }

  if (contactSignal) {
    return buildRoutingDecision({
      primaryIntent: 'contact_lookup',
      action: mixedSignals ? 'defer_to_agent' : 'handle_pre_agent',
      confidence: mixedSignals ? 'medium' : 'hard',
      mixedSignals,
      stateAffinity: stateActive ? 'switches_topic' : undefined,
      reasons: ['contact_directory_lookup'],
      allowedToolHints: ['get_important_contact'],
    });
  }

  if (input.hasPendingServiceOffer) {
    const pendingServiceDecision = detectExplicitConfirmationReply(normalized);
    if (isExplicitServiceActionRequest(normalized) || pendingServiceDecision === 'yes' || pendingServiceDecision === 'no') {
      return buildRoutingDecision({ primaryIntent: pendingServiceDecision === 'no' ? 'service_follow_up' : 'service_form_confirmation', action: 'handle_pre_agent', confidence: 'hard', stateAffinity: 'answers_pending_state', reasons: [pendingServiceDecision === 'no' ? 'declined_service_form_confirmation' : 'explicit_service_form_confirmation'], allowedToolHints: ['create_service_request'] });
    }
    if (isInformationalServiceLinkInquiry(normalized) || isPendingServiceFollowUp(normalized)) {
      return buildRoutingDecision({ primaryIntent: 'service_follow_up', action: 'handle_pre_agent', confidence: 'high', stateAffinity: 'answers_pending_state', reasons: ['pending_service_informational_follow_up'], allowedToolHints: ['get_service_info'] });
    }
    if (isClearlyDifferentIntent(normalized)) {
      return buildRoutingDecision({ primaryIntent: 'unknown', action: 'release_state_and_defer', confidence: 'high', stateAffinity: 'switches_topic', reasons: ['pending_service_topic_shift'] });
    }
  }

  if (input.hasPendingEmergencyOffer) {
    const confirmationDecision = detectExplicitConfirmationReply(normalized);
    if (confirmationDecision === 'yes' || confirmationDecision === 'no') {
      return buildRoutingDecision({
        primaryIntent: 'complaint_creation',
        action: 'handle_pre_agent',
        confidence: 'hard',
        stateAffinity: 'answers_pending_state',
        reasons: ['pending_emergency_offer_confirmation'],
        allowedToolHints: ['create_complaint', 'get_emergency_contacts'],
      });
    }
    if (isClearlyDifferentIntent(normalized) || villageProfileSignal) {
      return buildRoutingDecision({
        primaryIntent: contactSignal ? 'contact_lookup' : villageProfileSignal ? 'knowledge_query' : 'unknown',
        action: 'release_state_and_defer',
        confidence: 'high',
        mixedSignals,
        stateAffinity: 'switches_topic',
        reasons: ['pending_emergency_offer_topic_shift'],
        allowedToolHints: contactSignal ? ['get_important_contact'] : villageProfileSignal ? ['get_village_profile'] : undefined,
      });
    }
    return buildRoutingDecision({
      primaryIntent: 'complaint_creation',
      action: 'handle_pre_agent',
      confidence: 'medium',
      stateAffinity: 'answers_pending_state',
      reasons: ['pending_emergency_offer'],
      allowedToolHints: ['create_complaint', 'get_emergency_contacts'],
    });
  }

  if (input.hasPendingServiceClarification) {
    if (isClearlyDifferentIntent(normalized)) {
      return buildRoutingDecision({ primaryIntent: contactSignal ? 'contact_lookup' : 'unknown', action: 'release_state_and_defer', confidence: 'high', mixedSignals, stateAffinity: 'switches_topic', reasons: ['pending_clarification_topic_shift'], allowedToolHints: contactSignal ? ['get_important_contact'] : undefined });
    }
    return buildRoutingDecision({ primaryIntent: 'service_clarification', action: 'handle_pre_agent', confidence: 'medium', stateAffinity: 'answers_pending_state', reasons: ['pending_service_clarification'] });
  }

  if (input.hasActiveServiceInfo && (isPendingServiceFollowUp(normalized) || isPendingServiceLinkRequest(normalized))) {
    return buildRoutingDecision({ primaryIntent: 'service_follow_up', action: 'handle_pre_agent', confidence: 'high', stateAffinity: 'answers_pending_state', reasons: ['active_service_follow_up'], allowedToolHints: ['get_service_info', 'create_service_request'] });
  }

  if (isServiceListingQuery(normalized)) {
    return buildRoutingDecision({ primaryIntent: 'service_listing', action: mixedSignals ? 'defer_to_agent' : 'handle_pre_agent', confidence: mixedSignals ? 'medium' : 'high', mixedSignals, reasons: ['service_listing_query'], allowedToolHints: ['get_service_info'] });
  }

  if (emergencySignal) {
    return buildRoutingDecision({ primaryIntent: 'emergency_contact', action: mixedSignals ? 'defer_to_agent' : 'handle_pre_agent', confidence: mixedSignals ? 'medium' : 'high', mixedSignals, reasons: ['emergency_signal'], allowedToolHints: ['get_emergency_contacts', 'create_complaint'] });
  }

  if (complaintSignal) {
    return buildRoutingDecision({ primaryIntent: 'complaint_creation', action: mixedSignals ? 'defer_to_agent' : 'handle_pre_agent', confidence: mixedSignals ? 'medium' : 'high', mixedSignals, reasons: ['complaint_signal'], allowedToolHints: ['create_complaint', 'get_complaint_categories'] });
  }

  if (villageProfileSignal) {
    return buildRoutingDecision({ primaryIntent: 'knowledge_query', action: 'defer_to_agent', confidence: 'high', reasons: ['village_profile_query'], allowedToolHints: ['get_village_profile'] });
  }

  if (outOfScopeSignal) {
    return buildRoutingDecision({ primaryIntent: 'out_of_scope', action: mixedSignals ? 'defer_to_agent' : 'hard_block', confidence: mixedSignals ? 'medium' : 'high', mixedSignals, reasons: ['out_of_scope_signal'] });
  }

  return buildRoutingDecision({
    primaryIntent: input.unified?.message_type === 'QUESTION' ? 'knowledge_query' : 'unknown',
    action: 'defer_to_agent',
    confidence: input.unified?.confidence && input.unified.confidence >= 0.7 ? 'medium' : 'low',
    mixedSignals,
    stateAffinity: stateActive ? 'unclear' : undefined,
    reasons: input.unified?.reason ? [`classifier:${input.unified.reason}`] : ['no_hard_route'],
  });
}

function buildOutOfScopeRedirect(): string {
  return 'Maaf Pak/Bu, saya fokus membantu layanan desa dan penggunaan GovConnect. Kalau ada pertanyaan soal administrasi desa, pengaduan, status layanan, atau cara pakai GovConnect, saya bantu ya.';
}

interface PendingServiceInfoReplyContext {
  response: string;
  activeService: ActiveServiceInfoState;
}

async function buildPendingServiceInfoContext(
  serviceSlug: string,
  villageId?: string,
  sideEffectMode?: 'production' | 'evaluation' | 'knowledge_test',
): Promise<PendingServiceInfoReplyContext | null> {
  try {
    const { buildServiceInfoContext, getServiceCatalog } = await import('./case-client.service');
    const services = await getServiceCatalog(villageId);
    const service = services.find((item) => item.slug === serviceSlug && item.is_active !== false);
    if (!service) return null;

    const context = await buildServiceInfoContext(service, {
      villageId,
      allowFormLinkOffer: sideEffectMode !== 'knowledge_test' && sideEffectMode !== 'evaluation',
    });

    return {
      response: context.suggestedResponse,
      activeService: context.activeService,
    };
  } catch {
    return null;
  }
}

async function buildPendingServiceInfoReply(
  serviceSlug: string,
  villageId?: string,
  sideEffectMode?: 'production' | 'evaluation' | 'knowledge_test',
): Promise<string | null> {
  const context = await buildPendingServiceInfoContext(serviceSlug, villageId, sideEffectMode);
  return context?.response || null;
}

function buildPendingServiceClarificationPrompt(
  alternatives: PendingServiceClarificationAlternativeState[],
  intro: string = 'Ada beberapa layanan yang cocok. Biar tidak salah, Bapak/Ibu maksud yang mana?',
): string {
  const optionsList = alternatives.map((alternative, index) => `${index + 1}. ${alternative.name}`).join('\n');
  return `${intro}\n\n${optionsList}\n\nBalas dengan nomor atau nama layanannya ya.`;
}

const SERVICE_SELECTION_STOPWORDS = new Set([
  'yang', 'layanan', 'surat', 'nomor', 'no', 'opsi', 'option', 'pilih', 'maksud', 'mau', 'info', 'untuk', 'saya', 'pak', 'bu',
]);

function normalizeServiceSelectionValue(value: string): string {
  return (value || '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function extractOrdinalSelectionIndex(message: string): number | null {
  const normalized = normalizeServiceSelectionValue(message);
  const match = normalized.match(/(?:^| )(?:nomor|no|pilih|opsi|option|yang)?\s*(\d+|pertama|kedua|ketiga|keempat|kelima)(?:$| )/i);
  if (!match) return null;
  const token = match[1];
  const ordinalMap: Record<string, number> = {
    pertama: 1,
    kedua: 2,
    ketiga: 3,
    keempat: 4,
    kelima: 5,
  };
  const parsed = Number(token);
  if (Number.isFinite(parsed) && parsed >= 1) return parsed - 1;
  return ordinalMap[token] ? ordinalMap[token] - 1 : null;
}

function filterAlternativesByAttribute(
  alternatives: PendingServiceClarificationAlternativeState[],
  message: string,
): PendingServiceClarificationAlternativeState[] | null {
  const normalized = normalizeServiceSelectionValue(message);
  if (/\bonline\b/i.test(normalized)) {
    return alternatives.filter((alternative) => alternative.is_online === true);
  }
  if (/\boffline\b/i.test(normalized) || /\bke kantor\b/i.test(normalized)) {
    return alternatives.filter((alternative) => alternative.is_online === false);
  }
  return null;
}

interface PendingServiceClarificationResolution {
  resolutionMethod?: 'ordinal' | 'name_fragment' | 'attribute';
  selectedAlternative?: PendingServiceClarificationAlternativeState;
  narrowedAlternatives?: PendingServiceClarificationAlternativeState[];
}

function resolvePendingServiceClarification(
  message: string,
  alternatives: PendingServiceClarificationAlternativeState[],
): PendingServiceClarificationResolution | null {
  if (!alternatives.length) return null;

  const selectedIndex = extractOrdinalSelectionIndex(message);
  if (selectedIndex !== null) {
    return alternatives[selectedIndex]
      ? { resolutionMethod: 'ordinal', selectedAlternative: alternatives[selectedIndex] }
      : null;
  }

  const attributeMatches = filterAlternativesByAttribute(alternatives, message);
  if (attributeMatches?.length === 1) {
    return { resolutionMethod: 'attribute', selectedAlternative: attributeMatches[0] };
  }
  if (attributeMatches && attributeMatches.length > 1 && attributeMatches.length < alternatives.length) {
    return { resolutionMethod: 'attribute', narrowedAlternatives: attributeMatches };
  }

  const tokens = normalizeServiceSelectionValue(message)
    .split(' ')
    .map((token) => token.trim())
    .filter((token) => token.length > 1 && !SERVICE_SELECTION_STOPWORDS.has(token));

  if (tokens.length > 0) {
    const nameMatches = alternatives.filter((alternative) => {
      const normalizedName = normalizeServiceSelectionValue(alternative.name);
      return tokens.every((token) => normalizedName.includes(token));
    });

    if (nameMatches.length === 1) {
      return { resolutionMethod: 'name_fragment', selectedAlternative: nameMatches[0] };
    }

    if (nameMatches.length > 1 && nameMatches.length < alternatives.length) {
      return { resolutionMethod: 'name_fragment', narrowedAlternatives: nameMatches };
    }
  }

  return null;
}

function classifyActiveServiceFollowUpType(message: string): 'link' | 'requirements' | 'duration' | 'cost' | 'office_visit' | 'online' | 'fallback' {
  const normalized = (message || '').toLowerCase();
  if (isPendingServiceLinkRequest(message)) return 'link';
  if (/\b(syarat(?:nya)?|persyaratan(?:nya)?|dokumen(?:nya)?|berkas(?:nya)?)\b/i.test(normalized)) return 'requirements';
  if (/\b(berapa lama|lama proses(?:nya)?|proses(?:nya)?)\b/i.test(normalized)) return 'duration';
  if (/\b(biaya(?:nya)?|tarif(?:nya)?)\b/i.test(normalized)) return 'cost';
  if (/\b(harus ke kantor|ke kantor|offline)\b/i.test(normalized)) return 'office_visit';
  if (/\b(online|bisa online)\b/i.test(normalized)) return 'online';
  return 'fallback';
}

// ============================================================
// Service listing shortcut
// ============================================================

const SERVICE_LISTING_PATTERN = /\b(layanan|pelayanan|surat(?:\s+menyurat)?)(?:\s+desa)?\s+(apa|apa\s+(aja|saja)|yang\s+(ada|tersedia)|tersedia|bisa\s+(diurus|dilayani)|list)\b/i;
const SERVICE_LISTING_SHORT_PATTERN = /^\s*(apa\s+(aja|saja)\s+(layanan|pelayanan|surat)(\s+desa)?|layanan\s+(desa|yang\s+ada)|pelayanan\s+desa\s+apa\s+(aja|saja)|list\s+layanan|daftar\s+layanan|bisa\s+(urus|ngurus|mengurus|diurus)\s+apa\s+(aja|saja)(\s+di\s+(sini|desa))?)\s*\??\s*$/i;

export function isServiceListingQuery(message: string): boolean {
  const normalized = (message || '').toLowerCase().trim();
  if (!normalized) return false;
  if (SERVICE_LISTING_SHORT_PATTERN.test(normalized)) return true;
  if (SERVICE_LISTING_PATTERN.test(normalized) && !/\b(ktp|kk|akta|domisili|sktm|pindah|kematian|kelahiran|nikah)\b/i.test(normalized)) {
    return true;
  }
  return false;
}

function buildServiceListingResponse(
  services: Array<{ name: string; slug: string; category?: { name?: string } | null; mode?: string | null }>,
): string {
  if (services.length === 0) {
    return 'Saat ini belum ada layanan aktif yang terdaftar di sistem desa. Kalau Bapak/Ibu butuh bantuan tertentu, sebutkan keperluannya ya, nanti saya arahkan langkah berikutnya.';
  }

  // Group by category
  const byCategory = new Map<string, string[]>();
  for (const service of services) {
    const categoryName = service.category?.name || 'Lainnya';
    if (!byCategory.has(categoryName)) {
      byCategory.set(categoryName, []);
    }
    byCategory.get(categoryName)!.push(service.name);
  }

  const lines: string[] = ['Berikut layanan yang tersedia di desa saat ini:\n'];
  for (const [category, names] of byCategory) {
    lines.push(`*${category}*:`);
    for (const name of names.slice(0, 6)) {
      lines.push(`- ${name}`);
    }
    if (names.length > 6) {
      lines.push(`- dan ${names.length - 6} layanan lainnya di kategori ini`);
    }
    lines.push('');
  }

  lines.push('Kalau mau tahu syarat atau cara mengajukan salah satunya, tinggal sebut nama layanannya ya.');
  return lines.join('\n');
}

export async function tryHandleServiceListingShortcut(input: {
  message: string;
  villageId?: string;
  traceId: string;
  startTime: number;
  sideEffectMode?: 'production' | 'evaluation' | 'knowledge_test';
}): Promise<ProcessMessageResult | null> {
  if (!isServiceListingQuery(input.message)) {
    return null;
  }

  if (!input.villageId) {
    return null;
  }

  try {
    const services = (await getServiceCatalog(input.villageId)).filter((service) => service.is_active);
    const response = buildServiceListingResponse(services.slice(0, 30));

    return buildGuardResult({
      startTime: input.startTime,
      traceId: input.traceId,
      response,
      intent: 'SERVICE_INFO',
      hasKnowledge: services.length > 0,
      guardrail: {
        stage: 'pre_agent_service_listing',
        type: 'service_listing_shortcut',
        action: 'handled',
        reason: 'deterministic_catalog',
        details: {
          totalServices: services.length,
        },
      },
    });
  } catch {
    return null;
  }
}

export function tryHandleOutOfScopeGuard(input: {
  message: string;
  traceId: string;
  startTime: number;
}): ProcessMessageResult | null {
  const normalized = (input.message || '').toLowerCase();
  const hasVillageScopedSignal = GOVCONNECT_USAGE_PATTERN.test(input.message) || VILLAGE_SERVICE_SCOPE_PATTERN.test(input.message);
  // Village-help exemption: when the user asks about BPJS/SIM/NPWP but in
  // the context of asking for a village-side contact or rujukan (referral),
  // do NOT block — defer to the agent which can surface the relevant
  // kontak desa / puskesmas / kelurahan helper.
  const asksVillageHelp =
    /\b(siapa|nomor|kontak|telp|telepon|hp|wa|whatsapp|bantu|dibantu|rujuk|rujukan|pengantar|surat\s+pengantar|desa|kelurahan|kantor|pak|bu|ibu|bapak)\b/i.test(normalized);
  if (OUT_OF_SCOPE_PUBLIC_SERVICE_PATTERN.test(input.message) && !hasVillageScopedSignal && !asksVillageHelp && !/\b(lap|lay)-\d{8}-\d{3}\b/i.test(input.message)) {
    return buildGuardResult({
      startTime: input.startTime,
      traceId: input.traceId,
      response: 'Maaf Pak/Bu, informasi untuk layanan itu belum tersedia di sistem desa kami. Untuk penjelasan lebih lanjut, silakan datang langsung ke kantor desa pada jam kerja ya. Kalau ada layanan desa lain yang ingin ditanyakan, saya bantu cek.',
      intent: 'KNOWLEDGE_QUERY',
    });
  }

  if (isOutOfScopeGeneralQuestion(input.message)) {
    return buildGuardResult({
      startTime: input.startTime,
      traceId: input.traceId,
      response: buildOutOfScopeRedirect(),
      intent: 'QUESTION',
    });
  }

  return null;
}


function pickEmergencyContacts(
  message: string,
  contacts: Array<{ name: string; phone: string; description?: string | null; category?: { name?: string } | null }>,
): Array<{ name: string; phone: string; description?: string | null; category?: { name?: string } | null }> {
  const normalized = (message || '').toLowerCase();

  const keywordGroups: Array<{ test: RegExp; hints: string[] }> = [
    { test: /\b(kebakaran|damkar|pemadam)\b/i, hints: ['damkar', 'pemadam', 'kebakaran'] },
    { test: /\b(ambulans|ambulan|sakit|pingsan|kesehatan|medis)\b/i, hints: ['ambulans', 'ambulan', 'puskesmas', 'kesehatan', 'medis', 'rumah sakit'] },
    { test: /\b(polisi|pencurian|keamanan|kriminal)\b/i, hints: ['polisi', 'keamanan', 'danpos', 'polsek'] },
    { test: /\b(banjir|bencana|tanah longsor)\b/i, hints: ['bencana', 'damkar', 'polisi', 'keamanan'] },
  ];

  const haystack = (contact: { name: string; description?: string | null; category?: { name?: string } | null }) =>
    `${contact.name} ${contact.description || ''} ${contact.category?.name || ''}`.toLowerCase();

  const matchedGroup = keywordGroups.find((group) => group.test.test(normalized));
  if (matchedGroup) {
    const prioritized = contacts.filter((contact) =>
      matchedGroup.hints.some((hint) => haystack(contact).includes(hint)),
    );
    if (prioritized.length > 0) {
      return prioritized.slice(0, 3);
    }
  }

  const emergencyHints = ['damkar', 'pemadam', 'ambulans', 'ambulan', 'polisi', 'keamanan', 'puskesmas', 'darurat', 'bencana'];
  const filtered = contacts.filter((contact) =>
    emergencyHints.some((hint) => haystack(contact).includes(hint)),
  );

  return (filtered.length > 0 ? filtered : contacts).slice(0, 3);
}

interface ProtocolGuardInput {
  userId: string;
  mediaType?: string;
  traceId: string;
  startTime: number;
}

export function tryHandleProtocolGuards(
  input: ProtocolGuardInput,
): ProcessMessageResult | null {
  const mediaType = input.mediaType?.toLowerCase();
  if (!mediaType || !['voice', 'audio', 'sticker', 'gif', 'video_note'].includes(mediaType)) {
    return null;
  }

  const mediaLabels: Record<string, string> = {
    voice: 'pesan suara',
    audio: 'audio',
    sticker: 'sticker',
    gif: 'GIF',
    video_note: 'video',
  };
  const label = mediaLabels[mediaType] || mediaType;

  return buildGuardResult({
    startTime: input.startTime,
    traceId: input.traceId,
    response: `Mohon maaf, saat ini kami belum bisa memproses ${label}. Silakan ketik pesan dalam bentuk teks ya, Pak/Bu.\n\nKetik *bantuan* untuk melihat daftar layanan yang tersedia.`,
    intent: 'QUESTION',
  });
}

interface PendingServiceClarificationInput {
  userId: string;
  message: string;
  villageId?: string;
  traceId: string;
  startTime: number;
  sideEffectMode?: 'production' | 'evaluation' | 'knowledge_test';
}

const GREETING_ONLY_PATTERN = /^(halo|hai|hi|hello|hey|p|assalamu?\s?alaikum|assalamualaikum|permisi|selamat\s+(pagi|siang|sore|malam))[\s!.,?]*$/i;
const THANKS_ONLY_PATTERN = /^(terima\s*kasih|makasih|maksih|mksh|thx|thanks?|tq|ok(?:e)?\s+(?:makasih|terima\s*kasih))[\s!.,?]*$/i;

interface GreetingShortcutInput {
  message: string;
  userName?: string | null;
  villageName?: string | null;
  traceId: string;
  startTime: number;
  hasActiveState: boolean;
}

/**
 * Hard shortcut for pure greetings / thanks when there is no active state.
 * Returns a template reply without any LLM call. When a state is pending
 * (complaint address, service clarification, etc.), we defer to the agent
 * so the reply can consider the open flow.
 */
export function tryHandleGreetingShortcut(
  input: GreetingShortcutInput,
): ProcessMessageResult | null {
  if (input.hasActiveState) return null;
  const normalized = (input.message || '').trim().toLowerCase();
  if (!normalized || normalized.length > 40) return null;

  const isGreeting = GREETING_ONLY_PATTERN.test(normalized);
  const isThanks = THANKS_ONLY_PATTERN.test(normalized);
  if (!isGreeting && !isThanks) return null;

  const nameSuffix = input.userName ? `, ${input.userName}` : '';
  const villagePart = input.villageName ? ` ${input.villageName}` : '';

  const response = isThanks
    ? `Sama-sama${nameSuffix}. Kalau ada keperluan lain terkait layanan desa, tinggal kirim ke sini saja ya.`
    : `Halo${nameSuffix}, selamat datang di layanan desa${villagePart}. Saya bisa bantu urus pengaduan, informasi pelayanan (KTP, KK, surat domisili, SKTM), atau cek status laporan.\n\nAda yang bisa saya bantu?`;

  return buildGuardResult({
    startTime: input.startTime,
    traceId: input.traceId,
    response,
    intent: isThanks ? 'GRATITUDE' : 'GREETING',
    guardrail: {
      stage: 'pre_agent_shortcut',
      type: 'greeting_only',
      action: 'handled',
      reason: isThanks ? 'thanks_template' : 'greeting_template',
    },
  });
}

interface ActiveServiceFollowUpInput {
  userId: string;
  message: string;
  villageId?: string;
  traceId: string;
  startTime: number;
  sideEffectMode?: 'production' | 'evaluation' | 'knowledge_test';
}

function formatActiveServiceRequirements(requirements: ActiveServiceInfoState['requirements']): string {
  return requirements
    .slice(0, 6)
    .map((item) => `- ${item.label}${item.required ? '' : ' (opsional)'}`)
    .join('\n');
}

function buildActiveServiceFollowUpReply(
  activeService: ActiveServiceInfoState,
  message: string,
  sideEffectMode?: 'production' | 'evaluation' | 'knowledge_test',
): string | null {
  const normalized = (message || '').toLowerCase();
  const serviceName = activeService.service_name;
  const canSendLinkFromSession = activeService.can_send_form_link
    && sideEffectMode !== 'knowledge_test'
    && sideEffectMode !== 'evaluation';
  const asksLink = isPendingServiceLinkRequest(message);
  const asksRequirements = /\b(syarat(?:nya)?|persyaratan(?:nya)?|dokumen(?:nya)?|berkas(?:nya)?)\b/i.test(normalized);
  const asksDuration = /\b(berapa lama|lama proses(?:nya)?|proses(?:nya)?)\b/i.test(normalized);
  const asksCost = /\b(biaya(?:nya)?|tarif(?:nya)?)\b/i.test(normalized);
  const asksOfficeVisit = /\b(harus ke kantor|ke kantor|offline)\b/i.test(normalized);
  const asksOnline = /\b(online|bisa online)\b/i.test(normalized);

  if (asksLink) {
    if (activeService.is_online && canSendLinkFromSession) {
      return `Untuk layanan *${serviceName}*, pengajuan bisa dilakukan online.\n\nKalau Bapak/Ibu mau, saya bisa kirim link formulirnya. Balas *iya* ya.`;
    }

    if (activeService.is_online) {
      return `Untuk layanan *${serviceName}*, pengajuan memang bisa dilakukan online.\n\nHalaman ini hanya untuk uji jawaban, jadi saya belum mengirim link formulir dari sini. Untuk uji alur pengajuan, silakan gunakan kanal WhatsApp/Webchat produksi.`;
    }

    return `Untuk layanan *${serviceName}*, pengajuan saat ini belum tersedia lewat link online. Prosesnya dilakukan di kantor desa.`;
  }

  if (asksRequirements) {
    if (activeService.requirements_count > 0 && activeService.requirements.length > 0) {
      return `Syarat utama untuk layanan *${serviceName}* adalah:\n${formatActiveServiceRequirements(activeService.requirements)}`;
    }
    return null;
  }

  if (asksDuration) {
    if (activeService.estimated_processing_time) {
      return `Untuk layanan *${serviceName}*, estimasi prosesnya ${activeService.estimated_processing_time}.`;
    }
    return null;
  }

  if (asksCost) {
    if (activeService.estimated_cost) {
      return `Untuk layanan *${serviceName}*, perkiraan biayanya ${activeService.estimated_cost}.`;
    }
    return null;
  }

  if (asksOfficeVisit) {
    if (activeService.mode === 'both') {
      return `Untuk layanan *${serviceName}*, pengajuan bisa dilakukan online dan juga tersedia di kantor desa.`;
    }
    if (activeService.is_online) {
      return `Untuk layanan *${serviceName}*, pengajuan bisa dilakukan online, jadi tidak perlu datang ke kantor desa untuk mulai mengajukan.`;
    }
    return `Untuk layanan *${serviceName}*, pengajuan saat ini diproses di kantor desa.`;
  }

  if (asksOnline) {
    if (activeService.mode === 'both') {
      return `Bisa Pak/Bu, layanan *${serviceName}* bisa diajukan online dan juga tersedia di kantor desa.`;
    }
    if (activeService.is_online) {
      return canSendLinkFromSession
        ? `Bisa Pak/Bu, layanan *${serviceName}* bisa diajukan online. Kalau Bapak/Ibu mau, saya bisa kirim link formulirnya.`
        : `Bisa Pak/Bu, layanan *${serviceName}* bisa diajukan online.`;
    }
    return `Untuk layanan *${serviceName}*, pengajuan saat ini belum tersedia online dan diproses di kantor desa.`;
  }

  return activeService.suggested_response || null;
}

export async function tryHandlePendingServiceClarification(
  input: PendingServiceClarificationInput,
): Promise<ProcessMessageResult | null> {
  const pendingClarification = await getPendingServiceClarificationWithFallback(input.userId);
  if (!pendingClarification || pendingClarification.alternatives.length === 0) {
    return null;
  }

  if (isClearlyDifferentIntent(input.message)) {
    clearPendingServiceClarification(input.userId);
    return null;
  }

  const resolution = resolvePendingServiceClarification(input.message, pendingClarification.alternatives);

  if (resolution?.selectedAlternative) {
    clearPendingServiceClarification(input.userId);
    const context = await buildPendingServiceInfoContext(
      resolution.selectedAlternative.slug,
      pendingClarification.village_id || input.villageId,
      input.sideEffectMode,
    );

    if (!context) {
      return buildGuardResult({
        startTime: input.startTime,
        traceId: input.traceId,
        response: 'Maaf Pak/Bu, layanan yang dipilih belum bisa saya tampilkan sekarang. Coba sebutkan nama layanannya sekali lagi ya.',
        intent: 'SERVICE_INFO',
        hasKnowledge: true,
        guardrail: {
          stage: 'pre_agent_service_clarification',
          type: 'service_clarification',
          action: 'selection_missing',
          reason: resolution.resolutionMethod,
          details: {
            selectedServiceSlug: resolution.selectedAlternative.slug,
            selectedServiceName: resolution.selectedAlternative.name,
            alternativesCount: pendingClarification.alternatives.length,
            source: pendingClarification.source,
          },
        },
      });
    }

    setActiveServiceInfo(input.userId, context.activeService);
    if (context.activeService.can_send_form_link) {
      setPendingServiceFormOffer(input.userId, {
        service_slug: context.activeService.service_slug,
        village_id: context.activeService.village_id || input.villageId,
        timestamp: Date.now(),
      });
    }

    return buildGuardResult({
      startTime: input.startTime,
      traceId: input.traceId,
      response: context.response,
      intent: 'SERVICE_INFO',
      hasKnowledge: true,
      guardrail: {
        stage: 'pre_agent_service_clarification',
        type: 'service_clarification',
        action: 'resolved',
        reason: resolution.resolutionMethod,
        details: {
          selectedServiceSlug: context.activeService.service_slug,
          selectedServiceName: context.activeService.service_name,
          alternativesCount: pendingClarification.alternatives.length,
          source: pendingClarification.source,
        },
      },
    });
  }

  if (resolution?.narrowedAlternatives && resolution.narrowedAlternatives.length > 1) {
    const narrowedState: PendingServiceClarificationState = {
      ...pendingClarification,
      alternatives: resolution.narrowedAlternatives,
      timestamp: Date.now(),
    };
    setPendingServiceClarification(input.userId, narrowedState);
    return buildGuardResult({
      startTime: input.startTime,
      traceId: input.traceId,
      response: buildPendingServiceClarificationPrompt(
        resolution.narrowedAlternatives,
        'Saya sempitkan opsinya dulu ya. Bapak/Ibu maksud yang mana?',
      ),
      intent: 'SERVICE_INFO',
      hasKnowledge: true,
      guardrail: {
        stage: 'pre_agent_service_clarification',
        type: 'service_clarification',
        action: 'narrowed',
        reason: resolution.resolutionMethod,
        details: {
          alternativesCount: resolution.narrowedAlternatives.length,
          source: pendingClarification.source,
        },
      },
    });
  }

  const normalizedSelection = normalizeServiceSelectionValue(input.message);
  const tokenCount = normalizedSelection ? normalizedSelection.split(/\s+/).filter(Boolean).length : 0;
  const isAmbiguousShortReply = tokenCount > 0
    && tokenCount <= 3
    && (
      detectExplicitConfirmationReply(input.message) !== 'uncertain'
      || /^(yang\s+(tadi|itu|ini|atas|bawah)|itu|ini|tadi)$/i.test(normalizedSelection)
    );

  if (isAmbiguousShortReply) {
    return null;
  }

  return buildGuardResult({
    startTime: input.startTime,
    traceId: input.traceId,
    response: buildPendingServiceClarificationPrompt(pendingClarification.alternatives),
    intent: 'SERVICE_INFO',
    hasKnowledge: true,
    guardrail: {
      stage: 'pre_agent_service_clarification',
      type: 'service_clarification',
      action: 're_prompted',
      reason: 'unclear_selection',
      details: {
        alternativesCount: pendingClarification.alternatives.length,
        source: pendingClarification.source,
      },
    },
  });
}

export async function tryHandleActiveServiceFollowUp(
  input: ActiveServiceFollowUpInput,
): Promise<ProcessMessageResult | null> {
  const activeService = await getActiveServiceInfoWithFallback(input.userId);
  if (!activeService) {
    return null;
  }

  if (isClearlyDifferentIntent(input.message)) {
    clearActiveServiceInfo(input.userId);
    return null;
  }

  if (!isPendingServiceFollowUp(input.message) && !isPendingServiceLinkRequest(input.message)) {
    return null;
  }

  if (
    isPendingServiceLinkRequest(input.message)
    && activeService.is_online
    && activeService.can_send_form_link
    && input.sideEffectMode !== 'knowledge_test'
    && input.sideEffectMode !== 'evaluation'
  ) {
    setPendingServiceFormOffer(input.userId, {
      service_slug: activeService.service_slug,
      village_id: activeService.village_id || input.villageId,
      timestamp: Date.now(),
    });
  }

  const followUpType = classifyActiveServiceFollowUpType(input.message);
  const reply = buildActiveServiceFollowUpReply(activeService, input.message, input.sideEffectMode)
    || await buildPendingServiceInfoReply(activeService.service_slug, activeService.village_id || input.villageId, input.sideEffectMode);

  if (!reply) {
    return null;
  }

  return buildGuardResult({
    startTime: input.startTime,
    traceId: input.traceId,
    response: reply,
    intent: 'SERVICE_INFO',
    hasKnowledge: true,
    guardrail: {
      stage: 'pre_agent_active_service',
      type: 'active_service_follow_up',
      action: 'handled',
      reason: followUpType,
      details: {
        serviceSlug: activeService.service_slug,
        serviceName: activeService.service_name,
        followUpType,
      },
    },
  });
}

interface PendingOfferInput {
  userId: string;
  message: string;
  channel: 'whatsapp' | 'webchat';
  villageId?: string;
  traceId: string;
  startTime: number;
  sideEffectMode?: 'production' | 'evaluation' | 'knowledge_test';
  runWithMicroBudget: MicroBudgetRunner;
}

export async function tryHandlePendingOffers(
  input: PendingOfferInput,
): Promise<ProcessMessageResult | null> {
  const {
    userId,
    message,
    channel,
    villageId,
    traceId,
    startTime,
    sideEffectMode,
    runWithMicroBudget,
  } = input;

  const pendingOffer = await getPendingServiceFormOfferWithFallback(userId);
  if (pendingOffer) {
    const hasLapLayCode = /\b(LAP|LAY)-\d{8}-\d{3}\b/i.test(message);
    // Escape hatch: if the user clearly switched topic to a contact lookup or
    // a complaint incident, release the pending service form offer instead of
    // trapping them in a confirmation loop.
    const wantsContactLookup = isContactDirectoryLookup(message);
    const incidentSignal = /\b(jalan rusak|lampu mati|sampah|banjir|kebakaran|kecelakaan|pohon tumbang)\b/i.test(message);
    if (hasLapLayCode || wantsContactLookup || incidentSignal) {
      clearPendingServiceFormOffer(userId);
    } else {
      if (detectServiceCorrectionReply(message) || isClearlyDifferentIntent(message)) {
        clearPendingServiceFormOffer(userId);
        return null;
      }

      const explicitActionRequest = isExplicitServiceActionRequest(message);
      const informationalLinkInquiry = isInformationalServiceLinkInquiry(message);
      const serviceFollowUp = isPendingServiceFollowUp(message);
      let decision = explicitActionRequest ? 'yes' : detectExplicitConfirmationReply(message);
      if (decision === 'uncertain' && !informationalLinkInquiry && !serviceFollowUp) {
        const confirmationResult = await runWithMicroBudget(
          () => classifyConfirmation(message.trim(), {
            village_id: villageId,
            wa_user_id: userId,
            session_id: userId,
            channel,
          }),
          null,
        );
        decision = toConfirmationDecision(confirmationResult);
      }

      if (decision === 'yes') {
        clearPendingServiceFormOffer(userId);
        const linkReply = await handleServiceRequestCreation(userId, channel, {
          intent: 'CREATE_SERVICE_REQUEST',
          fields: {
            service_slug: pendingOffer.service_slug,
            ...(pendingOffer.village_id ? { village_id: pendingOffer.village_id } : {}),
          },
          reply_text: '',
        });
        const normalized = normalizeHandlerResult(linkReply);
        return buildGuardResult({
          startTime,
          traceId,
          response: normalized.replyText,
          guidanceText: normalized.guidanceText,
          intent: 'CREATE_SERVICE_REQUEST',
        });
      }

      if (decision === 'no') {
        clearPendingServiceFormOffer(userId);
        return buildGuardResult({
          startTime,
          traceId,
          response: 'Baik Pak/Bu, siap. Kalau Bapak/Ibu mau proses nanti, kabari kami ya.',
          intent: 'QUESTION',
        });
      }

      if (informationalLinkInquiry) {
        const followUpReply = await buildPendingServiceInfoReply(
          pendingOffer.service_slug,
          pendingOffer.village_id || villageId,
          sideEffectMode,
        );
        if (followUpReply) {
          return buildGuardResult({
            startTime,
            traceId,
            response: followUpReply,
            intent: 'SERVICE_INFO',
            hasKnowledge: true,
          });
        }
        return null;
      }

      if (serviceFollowUp && !isClearlyDifferentIntent(message)) {
        const followUpReply = await buildPendingServiceInfoReply(
          pendingOffer.service_slug,
          pendingOffer.village_id || villageId,
          sideEffectMode,
        );
        if (followUpReply) {
          return buildGuardResult({
            startTime,
            traceId,
            response: followUpReply,
            intent: 'SERVICE_INFO',
            hasKnowledge: true,
          });
        }
        return null;
      }

      if (!isClearlyDifferentIntent(message)) {
        return null;
      }

      clearPendingServiceFormOffer(userId);
    }
  }

  const pendingEmergency = await getPendingEmergencyComplaintOfferWithFallback(userId);
  if (!pendingEmergency) {
    return null;
  }

  // Escape hatches: contact directory lookup or a clear new complaint should
  // not be blocked by a pending emergency offer confirmation.
  if (isContactDirectoryLookup(message)) {
    clearPendingEmergencyComplaintOffer(userId);
    return null;
  }
  const hasNewIncidentKeyword = /\b(jalan rusak|lampu mati|sampah|banjir mendadak|pohon tumbang)\b/i.test(message);
  if (hasNewIncidentKeyword) {
    clearPendingEmergencyComplaintOffer(userId);
    return null;
  }

  let decision = detectExplicitConfirmationReply(message);
  if (decision === 'uncertain') {
    const confirmationResult = await runWithMicroBudget(
      () => classifyConfirmation(message.trim(), {
        village_id: villageId,
        wa_user_id: userId,
        session_id: userId,
        channel,
      }),
      null,
    );
    decision = toConfirmationDecision(confirmationResult);
  }

  if (decision === 'yes') {
    clearPendingEmergencyComplaintOffer(userId);
    const complaintResult = await handleComplaintCreation(userId, channel, {
      intent: 'CREATE_COMPLAINT',
      fields: {
        kategori: pendingEmergency.contact_entity || 'darurat',
        ...(pendingEmergency.village_id ? { village_id: pendingEmergency.village_id } : {}),
      },
      reply_text: '',
    }, message);
    const normalized = normalizeHandlerResult(complaintResult);
    return buildGuardResult({
      startTime,
      traceId,
      response: normalized.replyText,
      contacts: normalized.contacts,
      intent: 'CREATE_COMPLAINT',
    });
  }

  if (decision === 'no') {
    clearPendingEmergencyComplaintOffer(userId);
    return buildGuardResult({
      startTime,
      traceId,
      response: 'Baik Pak/Bu. Semoga situasinya segera tertangani. Jangan ragu hubungi kami jika butuh bantuan lagi.',
      intent: 'KNOWLEDGE_QUERY',
    });
  }

  return buildGuardResult({
    startTime,
    traceId,
    response: 'Apakah Bapak/Ibu ingin kami *buatkan laporan pengaduan* terkait situasi darurat ini? Balas *iya* atau *tidak*.',
    intent: 'KNOWLEDGE_QUERY',
  });
}

interface LatePreAgentInput {
  userId: string;
  message: string;
  channel: 'whatsapp' | 'webchat';
  villageId?: string;
  traceId: string;
  startTime: number;
  mediaUrl?: string;
  runWithMicroBudget: MicroBudgetRunner;
  tracker: TrackerLike;
  notifyStage: (stage: string, progress: number) => void;
}

export async function tryHandleLatePreAgentState(
  input: LatePreAgentInput,
): Promise<ProcessMessageResult | null> {
  const {
    userId,
    message,
    channel,
    villageId,
    traceId,
    startTime,
    mediaUrl,
    runWithMicroBudget,
    tracker,
    notifyStage,
  } = input;

  const lapMatch = message.match(/\b(LAP[-\s]?\d{8}[-\s]?\d{3})\b/i);
  const layMatch = message.match(/\b(LAY[-\s]?\d{8}[-\s]?\d{3})\b/i);

  if (
    (lapMatch || layMatch)
    && /\b(cek|status|tracking|lacak|periksa|lihat)\b/i.test(message)
    && !/\b(batal|batalkan|cancel|edit|ubah data|update data|perbarui data|perbaiki data|revisi data)\b/i.test(message)
  ) {
    const rawCode = (lapMatch?.[1] || layMatch?.[1])!.toUpperCase().replace(/\s/g, '');
    const prefix = rawCode.startsWith('LAP') ? 'LAP' : 'LAY';
    const digitsOnly = rawCode.replace(/^(LAP|LAY)-?/, '').replace(/-/g, '');
    const code = `${prefix}-${digitsOnly.slice(0, 8)}-${digitsOnly.slice(8)}`;
    const isLap = prefix === 'LAP';

    tracker.preparing();
    notifyStage('preparing', 80);
    const statusReply = await handleStatusCheck(userId, channel, {
      intent: 'CHECK_STATUS',
      fields: isLap ? { complaint_id: code } : { request_number: code },
      reply_text: '',
    }, message);
    tracker.complete();

    if (channel === 'whatsapp') {
      appendToHistoryCache(userId, 'assistant', statusReply);
    }

    return buildGuardResult({
      startTime,
      traceId,
      response: statusReply,
      intent: 'CHECK_STATUS',
    });
  }

  const pendingConfirm = await getPendingAddressConfirmationWithFallback(userId);
  if (pendingConfirm) {
    const confirmResult = await handlePendingAddressConfirmation(
      userId,
      message,
      pendingConfirm,
      channel,
      mediaUrl,
    );
    if (confirmResult) {
      return buildGuardResult({
        startTime,
        traceId,
        response: confirmResult,
        intent: 'CREATE_COMPLAINT',
      });
    }
  }

  const pendingAddr = await getPendingAddressRequestWithFallback(userId);
  if (pendingAddr) {
    const { decideAddressResume } = await import('./complaint-fsm.service');
    const decision = await decideAddressResume({
      userId,
      message,
      pendingAddr,
      channel,
    });

    if (decision.action === 'interrupt') {
      clearPendingAddressRequest(userId);
      // Fall through so the rest of the router (contact lookup, status, etc.)
      // or the agent can handle this turn.
      logger.info('🧭 complaint-fsm: pending address released due to interrupt', {
        userId,
        reason: decision.reason,
        messagePreview: message.substring(0, 60),
      });
    } else if (decision.action === 'resume') {
      clearPendingAddressRequest(userId);
      if (mediaUrl) addPendingPhoto(userId, mediaUrl);

      const complaintResult = await handleComplaintCreation(userId, channel, {
        fields: {
          village_id: pendingAddr.village_id,
          kategori: pendingAddr.kategori,
          deskripsi: pendingAddr.deskripsi,
          alamat: decision.alamat,
        },
      }, message);
      const normalized = normalizeHandlerResult(complaintResult);
      return buildGuardResult({
        startTime,
        traceId,
        response: normalized.replyText,
        contacts: normalized.contacts,
        intent: 'CREATE_COMPLAINT',
        guardrail: {
          stage: 'pre_agent_complaint_fsm',
          type: 'complaint_fsm_resume',
          action: 'resumed',
          reason: decision.reason,
          details: {
            waitingFor: 'alamat',
            extractedAddress: decision.alamat,
          },
        },
      });
    } else if (decision.action === 'reprompt') {
      if (decision.reason === 'not_address') {
        return buildGuardResult({
          startTime,
          traceId,
          response: 'Mohon maaf Pak/Bu, saya belum bisa mengenali lokasi dari pesan tersebut. Bisa disebutkan alamat lengkapnya? Misalnya nama jalan, RT/RW, atau patokan terdekat.',
          intent: 'CREATE_COMPLAINT',
          guardrail: {
            stage: 'pre_agent_complaint_fsm',
            type: 'complaint_fsm_reprompt',
            action: 'reprompted',
            reason: decision.reason,
          },
        });
      }
      // too_short → re-prompt with a friendlier nudge
      return buildGuardResult({
        startTime,
        traceId,
        response: 'Baik Pak/Bu, mohon sebutkan alamat lengkap lokasi kejadian ya. Bisa tulis nama jalan, RT/RW, atau patokan terdekat.',
        intent: 'CREATE_COMPLAINT',
        guardrail: {
          stage: 'pre_agent_complaint_fsm',
          type: 'complaint_fsm_reprompt',
          action: 'reprompted',
          reason: decision.reason,
        },
      });
    }
  }

  const pendingComplaint = await getPendingComplaintDataWithFallback(userId);
  if (pendingComplaint) {
    const { decideIdentityResume } = await import('./complaint-fsm.service');
    const identityDecision = await decideIdentityResume({
      userId,
      message,
      waitingFor: pendingComplaint.waitingFor,
      channel,
      villageId,
    });

    if (identityDecision.action === 'interrupt') {
      clearPendingComplaintData(userId);
      logger.info('🧭 complaint-fsm: pending identity released due to interrupt', {
        userId,
        reason: identityDecision.reason,
        waitingFor: pendingComplaint.waitingFor,
        messagePreview: message.substring(0, 60),
      });
    } else {
      const userProfile = await getAutoFillSuggestionsWithFallback(userId);

      if (pendingComplaint.waitingFor === 'nama') {
        if (identityDecision.action === 'resume' && identityDecision.extractedName) {
          const extractedName = identityDecision.extractedName;
          updateProfile(userId, { nama_lengkap: extractedName });
          syncNameToChannelService(userId, extractedName, villageId, channel);

          if (pendingComplaint.channel === 'webchat' && !userProfile.no_hp) {
            setPendingComplaintData(userId, {
              ...pendingComplaint,
              waitingFor: 'no_hp',
              timestamp: Date.now(),
            });
            return buildGuardResult({
              startTime,
              traceId,
              response: `Terima kasih Pak/Bu ${extractedName}. Mohon informasikan juga nomor telepon yang dapat dihubungi.`,
              intent: 'CREATE_COMPLAINT',
            });
          }

          clearPendingComplaintData(userId);
          const complaintResult = await handleComplaintCreation(userId, pendingComplaint.channel, {
            fields: {
              village_id: pendingComplaint.village_id,
              kategori: pendingComplaint.kategori,
              deskripsi: pendingComplaint.deskripsi,
              alamat: pendingComplaint.alamat,
              rt_rw: pendingComplaint.rt_rw,
            },
          }, message);
          const normalized = normalizeHandlerResult(complaintResult);
          return buildGuardResult({
            startTime,
            traceId,
            response: normalized.replyText,
            contacts: normalized.contacts,
            intent: 'CREATE_COMPLAINT',
          });
        }

        return buildGuardResult({
          startTime,
          traceId,
          response: 'Mohon maaf Pak/Bu, boleh tuliskan nama lengkap Anda untuk melanjutkan laporan?',
          intent: 'CREATE_COMPLAINT',
        });
      }

      if (identityDecision.action === 'resume' && identityDecision.extractedPhone) {
        const phone = identityDecision.extractedPhone;
        updateProfile(userId, { no_hp: phone });
        const channelUpper = (pendingComplaint.channel || 'webchat').toUpperCase() as 'WHATSAPP' | 'WEBCHAT';
        updateConversationUserProfile(userId, { user_phone: phone }, pendingComplaint.village_id, channelUpper)
          .catch(() => {});

        clearPendingComplaintData(userId);
        const complaintResult = await handleComplaintCreation(userId, pendingComplaint.channel, {
          fields: {
            village_id: pendingComplaint.village_id,
            kategori: pendingComplaint.kategori,
            deskripsi: pendingComplaint.deskripsi,
            alamat: pendingComplaint.alamat,
            rt_rw: pendingComplaint.rt_rw,
          },
        }, message);
        const normalized = normalizeHandlerResult(complaintResult);
        return buildGuardResult({
          startTime,
          traceId,
          response: normalized.replyText,
          contacts: normalized.contacts,
          intent: 'CREATE_COMPLAINT',
        });
      }

      return buildGuardResult({
        startTime,
        traceId,
        response: 'Mohon maaf Pak/Bu, format nomor telepon sepertinya kurang tepat. Silakan masukkan nomor HP yang valid (contoh: 081234567890).',
        intent: 'CREATE_COMPLAINT',
      });
    }
  }

  const isComplaintInfoQuestion =
    COMPLAINT_INFO_QUERY_PATTERN.test(message)
    && COMPLAINT_INFO_HINT_PATTERN.test(message);
  const isServiceLikeReportMessage =
    /\blapor\b/i.test(message)
    && SERVICE_EVENT_PATTERN.test(message);
  const hasComplaintLocationPhrase = /\b(rt\s*\d+|rw\s*\d+|dekat|depan|samping|belakang|dusun|lorong|gang|pertigaan|perempatan|patokan|pos ronda|nomor\s*rumah|jalan\s+[a-z0-9]|jl\.?\s+[a-z0-9]|di\s+(jalan|jl\.?|pertigaan|perempatan|depan|samping|belakang|dekat|dusun|gang|kantor|pasar|sekolah|masjid|pos|balai|desa|kelurahan|kecamatan))\b/i.test(message);
  const isLocationRichComplaintIncident =
    COMPLAINT_INCIDENT_PATTERN.test(message)
    && hasComplaintLocationPhrase
    && !/\b(di\s+rumah\s+saya|rumah\s+saya|rumahku|rumah\s+kami)\b/i.test(message);
  const looksLikeComplaintShortcut =
    !/\b(lap|lay)-\d{8}-\d{3}\b/i.test(message)
    && !isComplaintInfoQuestion
    && !isServiceLikeReportMessage
    && !SERVICE_ADMIN_PATTERN.test(message)
    && (
      COMPLAINT_INCIDENT_PATTERN.test(message)
      || EXPLICIT_REPORT_PATTERN.test(message)
    );

  const isEmergencyShortcut =
    !!villageId
    && EMERGENCY_PATTERN.test(message)
    && !EXPLICIT_REPORT_PATTERN.test(message)
    && !isLocationRichComplaintIncident
    && !/\b(lap|lay)-\d{8}-\d{3}\b/i.test(message)
    && !isContactDirectoryLookup(message);

  // Contact directory lookup shortcut: user asks for a number without being in
  // active emergency. Route deterministically to the contact directory.
  const isContactLookupShortcut =
    !!villageId
    && !/\b(lap|lay)-\d{8}-\d{3}\b/i.test(message)
    && !EXPLICIT_REPORT_PATTERN.test(message)
    && isContactDirectoryLookup(message);

  if (isContactLookupShortcut) {
    const lookup = await lookupImportantContacts(message, villageId, { limit: 3 });

    if (lookup.matches.length > 0) {
      const topMatch = lookup.matches[0];
      const isConfident =
        topMatch.score >= 0.75
        && (lookup.matches.length === 1 || topMatch.score - lookup.matches[1].score >= 0.15);

      const formatLine = (match: typeof lookup.matches[number], index?: number) => {
        const prefix = typeof index === 'number' ? `${index + 1}. ` : '';
        const descriptor = match.contact.category?.name ? ` (${match.contact.category.name})` : '';
        const desc = match.contact.description ? `\n   ${match.contact.description}` : '';
        return `${prefix}*${match.contact.name}*${descriptor}\n   ${match.contact.phone}${desc}`;
      };

      const vcardContacts = toVCardContacts(
        lookup.matches.map((match) => ({
          name: match.contact.name,
          phone: match.contact.phone,
          description: match.contact.description,
          category: match.contact.category?.name ? { name: match.contact.category.name } : null,
        })),
      );

      const response = isConfident
        ? formatLine(lookup.matches[0])
        : `Beberapa kontak yang cocok:\n\n${lookup.matches.map((match, index) => formatLine(match, index)).join('\n\n')}\n\nKalau belum sesuai, sebutkan nama atau jabatan yang lebih spesifik ya.`;

      return buildGuardResult({
        startTime,
        traceId,
        response,
        contacts: vcardContacts,
        intent: 'CONTACT_DIRECTORY',
        guardrail: {
          stage: 'pre_agent_contact_directory',
          type: 'contact_directory_lookup',
          action: 'handled',
          reason: isConfident ? 'confident_match' : 'multiple_matches',
          details: {
            matchCount: lookup.matches.length,
            topScore: topMatch.score,
            roleHint: lookup.role_hint,
            categoryHint: lookup.category_hint,
          },
        },
      });
    }

    // No direct match: return honest "not found" at the router level so we
    // never fabricate a number. The agent can still help with follow-up.
    return buildGuardResult({
      startTime,
      traceId,
      response: `Maaf Pak/Bu, saya belum menemukan nomor yang cocok untuk permintaan tersebut di daftar kontak desa.\n\nKalau mau, sebutkan nama atau jabatan yang lebih spesifik ya.`,
      intent: 'CONTACT_DIRECTORY',
      guardrail: {
        stage: 'pre_agent_contact_directory',
        type: 'contact_directory_lookup',
        action: 'handled',
        reason: 'no_match',
        details: {
          totalCandidates: lookup.total_candidates,
          roleHint: lookup.role_hint,
          categoryHint: lookup.category_hint,
        },
      },
    });
  }

  if (isEmergencyShortcut) {
    const contacts = pickEmergencyContacts(message, await getImportantContacts(villageId));
    const contactsMessage = buildImportantContactsMessage(contacts, channel);
    const vcardContacts = toVCardContacts(
      contacts.map((contact) => ({
        ...contact,
        category: contact.category?.name ? { name: contact.category.name } : null,
      })),
    );

    setPendingEmergencyComplaintOffer(userId, {
      contact_entity: message.trim(),
      village_id: villageId,
      timestamp: Date.now(),
    });

    const emergencyFallback = 'Jika tidak tersambung, hubungi layanan darurat nasional: polisi *110*, ambulans *119*, dan pemadam *113*.';

    return buildGuardResult({
      startTime,
      traceId,
      response: contacts.length > 0
        ? `Situasi ini darurat, mohon segera hubungi sekarang juga.${contactsMessage}\n\n${emergencyFallback}\n\nKalau perlu, saya juga bisa bantu buatkan laporan kejadian ini agar langsung tercatat ke petugas desa. Balas *iya* jika mau saya lanjutkan.`
        : `Situasi ini darurat, mohon segera hubungi layanan darurat terdekat sekarang juga.\n\n${emergencyFallback}\n\nKalau perlu, saya juga bisa bantu buatkan laporan kejadian ini agar langsung tercatat ke petugas desa. Balas *iya* jika mau saya lanjutkan.`,
      contacts: vcardContacts,
      intent: 'EMERGENCY_CONTACTS',
    });
  }

  if (/^\s*(mau\s+lapor|lapor)\s*$/i.test(message)) {
    return buildGuardResult({
      startTime,
      traceId,
      response: 'Boleh Pak/Bu. Maksudnya mau lapor pengaduan infrastruktur/lingkungan, atau lapor untuk layanan administrasi seperti kematian, kelahiran, pindah, atau surat?\n\nBalas singkat ya, misalnya: *jalan rusak* atau *lapor kematian*.',
      intent: 'QUESTION',
    });
  }

  if (looksLikeComplaintShortcut && /\b(dekat|depan|samping|belakang)\b/i.test(message) && !/\b(jl\.?|rt\.?\s*\d+|rw\.?\s*\d+|no\.?\s*\d+|dusun|desa|kelurahan|kecamatan)\b/i.test(message)) {
    setPendingAddressRequest(userId, {
      kategori: message.trim(),
      deskripsi: message.trim(),
      village_id: villageId,
      timestamp: Date.now(),
    });

    return buildGuardResult({
      startTime,
      traceId,
      response: 'Baik Pak/Bu, mohon tambahkan detail alamat lokasi kejadian dulu ya, misalnya nama jalan, RT/RW, nomor rumah, atau patokan yang lebih lengkap.',
      intent: 'CREATE_COMPLAINT',
    });
  }

  if (looksLikeComplaintShortcut) {
    const complaintResult = await handleComplaintCreation(
      userId,
      channel,
      {
        intent: 'CREATE_COMPLAINT',
        fields: {
          village_id: villageId,
          kategori: message.trim(),
          deskripsi: message.trim(),
        },
        reply_text: '',
      },
      message,
      mediaUrl,
    );
    const normalized = normalizeHandlerResult(complaintResult);
    return buildGuardResult({
      startTime,
      traceId,
      response: normalized.replyText,
      contacts: normalized.contacts,
      intent: 'CREATE_COMPLAINT',
    });
  }

  if (mediaUrl && message.trim().length < 5) {
    const hasActiveComplaintFlow = pendingAddr || pendingConfirm || pendingComplaint;

    if (hasActiveComplaintFlow) {
      const photoCount = getPendingPhotoCount(userId);
      if (photoCount >= MAX_PHOTOS_PER_COMPLAINT) {
        return buildGuardResult({
          startTime,
          traceId,
          response: `Maaf Pak/Bu, maksimal ${MAX_PHOTOS_PER_COMPLAINT} foto per laporan. Foto sebelumnya sudah kami simpan. Silakan lanjutkan menjawab pertanyaan kami.`,
          intent: 'CREATE_COMPLAINT',
        });
      }

      addPendingPhoto(userId, mediaUrl);
      const newCount = getPendingPhotoCount(userId);
      const remaining = MAX_PHOTOS_PER_COMPLAINT - newCount;
      return buildGuardResult({
        startTime,
        traceId,
        response: `✅ Foto ke-${newCount} sudah kami terima.${remaining > 0 ? ` Anda masih bisa mengirim ${remaining} foto lagi.` : ' Batas foto sudah tercapai.'} Silakan lanjutkan menjawab pertanyaan sebelumnya ya Pak/Bu.`,
        intent: 'CREATE_COMPLAINT',
      });
    }

    addPendingPhoto(userId, mediaUrl);
    const savedProfile = await getAutoFillSuggestionsWithFallback(userId);
    const userName = savedProfile.nama_lengkap;
    const nameGreeting = userName ? ` ${userName}` : '';
    tracker.complete();
    return buildGuardResult({
      startTime,
      traceId,
      response: `Terima kasih Pak/Bu${nameGreeting}, foto sudah kami terima. Jika ingin melaporkan pengaduan, silakan jelaskan masalahnya dan foto akan kami lampirkan otomatis.`,
      intent: 'QUESTION',
    });
  }

  let pendingCancel = await getPendingCancelConfirmationWithFallback(userId);
  if (!pendingCancel && detectExplicitConfirmationReply(message) === 'yes' && channel === 'whatsapp') {
    const history = await fetchConversationHistoryFromChannel(userId, villageId);
    const recentAssistant = history
      .filter((item) => item.role === 'assistant')
      .map((item) => item.content || '')
      .reverse()
      .find((content) => /yakin ingin membatalkan/i.test(content) && /balas\s+ya\s+untuk\s+konfirmasi/i.test(content));
    const recentCode = recentAssistant?.match(/\b(LAP|LAY)-\d{8}-\d{3}\b/i)?.[0]?.toUpperCase();
    if (recentCode) {
      pendingCancel = {
        type: recentCode.startsWith('LAP-') ? 'laporan' as const : 'layanan' as const,
        id: recentCode,
        reason: undefined,
        timestamp: Date.now(),
      };
    }
  }
  if (!pendingCancel && /\bya\b/i.test(message) && channel === 'whatsapp') {
    const explicitCancelCode = message.match(/\b(LAP|LAY)-\d{8}-\d{3}\b/i)?.[0]?.toUpperCase();
    if (explicitCancelCode) {
      pendingCancel = {
        type: explicitCancelCode.startsWith('LAP-') ? 'laporan' as const : 'layanan' as const,
        id: explicitCancelCode,
        reason: undefined,
        timestamp: Date.now(),
      };
    }
  }
  if (pendingCancel) {
    const normalizedMessage = message.trim();
    const isFreshCancelRequest = /\b(LAP|LAY)-?\d{8}-?\d{3}\b/i.test(normalizedMessage)
      && /\b(batal|batalkan|cancel)\b/i.test(normalizedMessage);

    if (isFreshCancelRequest) {
      clearPendingCancelConfirmation(userId);
    } else {
    let decision = detectExplicitConfirmationReply(message);
    if (decision === 'uncertain') {
      const cancelResult = await runWithMicroBudget(
        () => classifyConfirmation(message.trim(), {
          village_id: villageId,
          wa_user_id: userId,
          session_id: userId,
          channel,
        }),
        null,
      );
      decision = toConfirmationDecision(cancelResult);
    }

    if (decision === 'yes') {
      clearPendingCancelConfirmation(userId);
      if (pendingCancel.type === 'laporan') {
        const result = await cancelComplaint(
          pendingCancel.id,
          buildChannelParams(channel, userId),
          pendingCancel.reason,
        );
        if (result.success) {
          void rememberMemoryEvent({
            wa_user_id: userId,
            village_id: villageId,
            memory_type: 'cancellation',
            memory_key: pendingCancel.id,
            importance: 0.82,
            content: `Laporan ${pendingCancel.id} dibatalkan user.`,
            metadata_json: {
              reference_number: pendingCancel.id,
              reference_type: 'complaint',
              reason: pendingCancel.reason,
            },
          });
        }
        return buildGuardResult({
          startTime,
          traceId,
          response: result.success
            ? buildCancelSuccessResponse('laporan', pendingCancel.id, result.message)
            : buildCancelErrorResponse('laporan', pendingCancel.id, result.error, result.message),
          intent: 'CANCEL_COMPLAINT',
        });
      }

      const serviceResult = await cancelServiceRequest(
        pendingCancel.id,
        buildChannelParams(channel, userId),
        pendingCancel.reason,
      );
      if (serviceResult.success) {
        void rememberMemoryEvent({
          wa_user_id: userId,
          village_id: villageId,
          memory_type: 'cancellation',
          memory_key: pendingCancel.id,
          importance: 0.82,
          content: `Permohonan layanan ${pendingCancel.id} dibatalkan user.`,
          metadata_json: {
            reference_number: pendingCancel.id,
            reference_type: 'service_request',
            reason: pendingCancel.reason,
          },
        });
      }
      return buildGuardResult({
        startTime,
        traceId,
        response: serviceResult.success
          ? buildCancelSuccessResponse('layanan', pendingCancel.id, serviceResult.message)
          : buildCancelErrorResponse('layanan', pendingCancel.id, serviceResult.error, serviceResult.message),
        intent: 'CANCEL_SERVICE_REQUEST',
      });
    }

    if (decision === 'no') {
      clearPendingCancelConfirmation(userId);
      return buildGuardResult({
        startTime,
        traceId,
        response: 'Baik Pak/Bu, laporan/layanan Anda tidak jadi dibatalkan. Ada yang bisa kami bantu lagi?',
        intent: 'QUESTION',
      });
    }

    return buildGuardResult({
      startTime,
      traceId,
        response: 'Mohon konfirmasi ya Pak/Bu. Balas "YA" untuk melanjutkan pembatalan, atau "TIDAK" untuk membatalkan.',
        intent: pendingCancel.type === 'laporan' ? 'CANCEL_COMPLAINT' : 'CANCEL_SERVICE_REQUEST',
      });
    }
  }

  if ((lapMatch || layMatch) && /\b(batal|batalkan|cancel)\b/i.test(message)) {
    const rawCode = (lapMatch?.[1] || layMatch?.[1])!.toUpperCase().replace(/\s/g, '');
    const prefix = rawCode.startsWith('LAP') ? 'LAP' : 'LAY';
    const digitsOnly = rawCode.replace(/^(LAP|LAY)-?/, '').replace(/-/g, '');
    const code = `${prefix}-${digitsOnly.slice(0, 8)}-${digitsOnly.slice(8)}`;
    const isComplaint = prefix === 'LAP';

    tracker.preparing();
    notifyStage('preparing', 80);

    const cancelReply = await handleCancellationRequest(
      userId,
      isComplaint ? 'laporan' : 'layanan',
      {
        intent: isComplaint ? 'CANCEL_COMPLAINT' : 'CANCEL_SERVICE_REQUEST',
        fields: isComplaint ? { complaint_id: code } : { request_number: code },
        reply_text: '',
      },
    );

    tracker.complete();

    if (channel === 'whatsapp') {
      appendToHistoryCache(userId, 'assistant', cancelReply);
    }

    return buildGuardResult({
      startTime,
      traceId,
      response: cancelReply,
      intent: isComplaint ? 'CANCEL_COMPLAINT' : 'CANCEL_SERVICE_REQUEST',
    });
  }

  if (/\b(cek|status|tracking|lacak|periksa|lihat)\b/i.test(message) && /\blayanan\b/i.test(message) && !/\b(LAP|LAY)[-\s]?\d{8}[-\s]?\d{3}\b/i.test(message)) {
    const history = await getUserHistory({
      wa_user_id: channel === 'whatsapp' ? userId : undefined,
      channel: channel === 'whatsapp' ? 'WHATSAPP' : 'WEBCHAT',
      channel_identifier: channel === 'webchat' ? userId : undefined,
    });
    let requestNumber = history?.services?.[0]?.request_number || history?.combined?.find((item: any) => item.type === 'service')?.display_id;
    if (!requestNumber && channel === 'whatsapp') {
      const conversation = await fetchConversationHistoryFromChannel(userId, villageId);
      const recentServiceNumbers = conversation
        .filter((item) => item.role === 'assistant')
        .map((item) => Array.from(item.content.matchAll(/\bLAY-\d{8}-\d{3,4}\b/gi)).map((match) => match[0].toUpperCase()))
        .flat();
      requestNumber = recentServiceNumbers[recentServiceNumbers.length - 1];
    }

    if (requestNumber) {
      tracker.preparing();
      notifyStage('preparing', 80);
      const statusReply = await handleStatusCheck(userId, channel, {
        intent: 'CHECK_STATUS',
        fields: { request_number: requestNumber },
        reply_text: '',
      }, message);
      tracker.complete();

      if (channel === 'whatsapp') {
        appendToHistoryCache(userId, 'assistant', statusReply);
      }

      return buildGuardResult({
        startTime,
        traceId,
        response: statusReply,
        intent: 'CHECK_STATUS',
      });
    }
  }

  if (layMatch && /\b(edit|ubah data|update data|perbarui data|perbaiki data|revisi data)\b/i.test(message)) {
    const rawCode = layMatch[1].toUpperCase().replace(/\s/g, '');
    const digitsOnly = rawCode.replace(/^LAY-?/, '').replace(/-/g, '');
    const code = `LAY-${digitsOnly.slice(0, 8)}-${digitsOnly.slice(8)}`;

    tracker.preparing();
    notifyStage('preparing', 80);

    const editReply = await handleServiceRequestEditLink(userId, channel, {
      intent: 'EDIT_SERVICE_REQUEST',
      fields: { request_number: code },
      reply_text: '',
    });
    const normalized = normalizeHandlerResult(editReply);

    tracker.complete();

    if (channel === 'whatsapp') {
      appendToHistoryCache(userId, 'assistant', normalized.replyText);
      if (normalized.guidanceText) {
        appendToHistoryCache(userId, 'assistant', normalized.guidanceText);
      }
    }

    return buildGuardResult({
      startTime,
      traceId,
      response: normalized.replyText,
      guidanceText: normalized.guidanceText,
      intent: 'EDIT_SERVICE_REQUEST',
    });
  }

  if (lapMatch || layMatch) {
    const normalized = message.toLowerCase();
    const isExplicitNonStatusReference = /\b(batal|batalkan|cancel|edit|ubah|update|perbarui|perbaiki|revisi|detail|rincian|foto|gambar|lampiran|tambah keterangan)\b/i.test(normalized);
    const isExplicitStatusRequest = /\b(cek|status|tracking|lacak|periksa|lihat)\b/i.test(normalized);
    const isBareReference = normalized.trim().match(/^(lap|lay)[-\s]?\d{8}[-\s]?\d{3}$/i);

    if (isExplicitNonStatusReference && !isExplicitStatusRequest) {
      return null;
    }

    if (!isExplicitStatusRequest && !isBareReference) {
      return null;
    }

    const rawCode = (lapMatch?.[1] || layMatch?.[1])!.toUpperCase().replace(/\s/g, '');
    const prefix = rawCode.startsWith('LAP') ? 'LAP' : 'LAY';
    const digitsOnly = rawCode.replace(/^(LAP|LAY)-?/, '').replace(/-/g, '');
    const code = `${prefix}-${digitsOnly.slice(0, 8)}-${digitsOnly.slice(8)}`;
    const isLap = prefix === 'LAP';

    tracker.preparing();
    notifyStage('preparing', 80);
    const statusReply = await handleStatusCheck(userId, channel, {
      intent: 'CHECK_STATUS',
      fields: isLap ? { complaint_id: code } : { request_number: code },
      reply_text: '',
    }, message);
    tracker.complete();

    if (channel === 'whatsapp') {
      appendToHistoryCache(userId, 'assistant', statusReply);
    }

    return buildGuardResult({
      startTime,
      traceId,
      response: statusReply,
      intent: 'CHECK_STATUS',
    });
  }

  return null;
}

export const __test_only__ = {
  detectExplicitConfirmationReply,
  detectServiceCorrectionReply,
  isPendingServiceFollowUp,
  isPendingServiceLinkRequest,
  isInformationalServiceLinkInquiry,
  isExplicitServiceActionRequest,
  isClearlyDifferentIntent,
  decideFastIntent,
  buildOutOfScopeRedirect,
  buildActiveServiceFollowUpReply,
  buildPendingServiceClarificationPrompt,
  resolvePendingServiceClarification,
  classifyActiveServiceFollowUpType,
};
