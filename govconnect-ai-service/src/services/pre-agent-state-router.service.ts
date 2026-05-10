import {
  cancelComplaint,
  cancelServiceRequest,
  getUserHistory,
} from './case-client.service';
import { updateConversationUserProfile } from './channel-client.service';
import { rememberMemoryEvent } from './hybrid-memory.service';
import { handleCancellationRequest, handleComplaintCreation, handlePendingAddressConfirmation } from './complaint-handler';
import { classifyConfirmation } from './confirmation-classifier.service';
import {
  analyzeAddress,
  UnifiedClassifyResult,
} from './micro-llm-matcher.service';
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
  clearPendingServiceFormOffer,
  getActiveServiceInfoWithFallback,
  getPendingAddressConfirmationWithFallback,
  getPendingAddressRequestWithFallback,
  getPendingCancelConfirmationWithFallback,
  getPendingComplaintDataWithFallback,
  getPendingEmergencyComplaintOfferWithFallback,
  getPendingPhotoCount,
  getPendingServiceFormOfferWithFallback,
  setPendingAddressRequest,
  setPendingComplaintData,
  setPendingEmergencyComplaintOffer,
  setPendingServiceFormOffer,
  syncNameToChannelService,
  type ActiveServiceInfoState,
} from './ump-state';
import {
  appendToHistoryCache,
  extractAddressFromMessage,
  extractNameFromTextNLU,
  fetchConversationHistoryFromChannel,
} from './ump-utils';
import { getAutoFillSuggestionsWithFallback, updateProfile } from './user-profile.service';
import { getImportantContacts } from './important-contacts.service';

type MicroBudgetRunner = <T>(task: () => Promise<T>, fallback: T) => Promise<T>;
type TrackerLike = {
  preparing(): void;
  complete(): void;
};

function buildGuardResult(input: {
  startTime: number;
  traceId: string;
  response: string;
  guidanceText?: string;
  intent: string;
  hasKnowledge?: boolean;
  contacts?: ProcessMessageResult['contacts'];
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
  ];

  if (explicitYesPatterns.some((pattern) => pattern.test(normalized))) {
    return 'yes';
  }

  if (explicitNoPatterns.some((pattern) => pattern.test(normalized))) {
    return 'no';
  }

  return 'uncertain';
}

const COMPLAINT_INCIDENT_PATTERN = /\b(jalan rusak|jalan berlubang|lampu mati|sampah|drainase|selokan|banjir|pohon tumbang|fasilitas rusak|aspal rusak|jalan licin|jalan amblas)\b/i;
const COMPLAINT_INFO_QUERY_PATTERN = /\b(pengaduan|keluhan|laporan)\b/i;
const COMPLAINT_INFO_HINT_PATTERN = /\b(apa|bagaimana|gimana|jelaskan|contoh|format|prioritas|checklist|sop|panduan|prosedur|alur|status)\b/i;
const SERVICE_ADMIN_PATTERN = /\b(surat|ktp|kk|akta|domisili|sktm|layanan|permohonan|pengantar)\b/i;
const EMERGENCY_PATTERN = /\b(kebakaran|damkar|pemadam|ambulans|ambulan|orang sakit keras|kecelakaan|polisi|pencurian|darurat|bencana|banjir mendadak|longsor|gempa|tsunami|evakuasi|ledakan)\b/i;
const EXPLICIT_REPORT_PATTERN = /\b(ingin lapor|buat laporan|buat pengaduan|laporkan|saya lapor|saya mau lapor|aduan)\b/i;
const SERVICE_EVENT_PATTERN = /\b(meninggal|kematian|lahir|kelahiran|pindah|nikah|cerai|ktp|kk|domisili|akta|sktm|surat)\b/i;
const OUT_OF_SCOPE_PUBLIC_SERVICE_PATTERN = /\b(sim|paspor|bpjs|visa|imigrasi|npwp|stnk|bpkb)\b/i;
const OUT_OF_SCOPE_GENERAL_PATTERN = /\b(javascript|typescript|python|java|coding|ngoding|code|program|programmer|console\.log|for\s*\(|while\s*\(|loop\b|algoritma|matematika|rumus|1\s*\+\s*1|game|sepak bola|film|artis|zodiak)\b/i;
const SERVICE_PENDING_LINK_PATTERN = /\b(link(?:nya)?|tautan(?:nya)?|form(?:nya)?|formulir(?:nya)?|kirim(?:kan)?\s+link|link\s+formulir|daftar\s+online|ajukan\s+online|isi\s+formulir)\b/i;
const SERVICE_PENDING_INFO_PATTERN = /\b(syarat(?:nya)?|persyaratan(?:nya)?|biaya(?:nya)?|berapa lama|lama proses(?:nya)?|proses(?:nya)?|dokumen(?:nya)?|berkas(?:nya)?|harus ke kantor|ke kantor|offline|online|link(?:nya)?|form(?:nya)?)\b/i;
const GOVCONNECT_USAGE_PATTERN = /\b(govconnect|whatsapp|webchat|lay-|lap-|cek status|riwayat|pengaduan|layanan desa|kantor desa)\b/i;
const VILLAGE_SERVICE_SCOPE_PATTERN = /\b(surat|ktp|kk|akta|domisili|sktm|layanan|permohonan|pengaduan|laporan|status|kantor desa|jam buka|kontak|darurat)\b/i;

function isOutOfScopeGeneralQuestion(message: string): boolean {
  const normalized = (message || '').toLowerCase();
  if (/\b(lap|lay)-\d{8}-\d{3}\b/i.test(message)) return false;
  if (GOVCONNECT_USAGE_PATTERN.test(normalized) || VILLAGE_SERVICE_SCOPE_PATTERN.test(normalized)) return false;
  return OUT_OF_SCOPE_GENERAL_PATTERN.test(normalized);
}

function isPendingServiceFollowUp(message: string): boolean {
  return SERVICE_PENDING_INFO_PATTERN.test((message || '').toLowerCase());
}

function isPendingServiceLinkRequest(message: string): boolean {
  return SERVICE_PENDING_LINK_PATTERN.test((message || '').toLowerCase());
}

function isClearlyDifferentIntent(message: string): boolean {
  const normalized = (message || '').toLowerCase();
  return /\b(mau lapor|lapor jalan|lampu mati|sampah|darurat|cek status|riwayat|batal|batalkan|edit layanan|ubah data)\b/i.test(normalized);
}

function buildOutOfScopeRedirect(): string {
  return 'Maaf Pak/Bu, saya fokus membantu layanan desa dan penggunaan GovConnect. Kalau ada pertanyaan soal administrasi desa, pengaduan, status layanan, atau cara pakai GovConnect, saya bantu ya.';
}

async function buildPendingServiceInfoReply(serviceSlug: string, villageId?: string): Promise<string | null> {
  try {
    const { getServiceCatalog, getServiceRequirements } = await import('./case-client.service');
    const services = await getServiceCatalog(villageId);
    const service = services.find((item) => item.slug === serviceSlug && item.is_active !== false);
    if (!service) return null;
    const requirements = Array.isArray(service.requirements) && service.requirements.length > 0
      ? service.requirements
      : await getServiceRequirements(service.id || service.slug);
    const requirementLines = requirements.slice(0, 6).map((item) => `- ${item.label}${item.is_required ? '' : ' (opsional)'}`);
    const detailLines = [
      `Untuk layanan *${service.name}*:` ,
      service.estimated_processing_time ? `- Estimasi proses: ${service.estimated_processing_time}` : '',
      service.estimated_cost ? `- Perkiraan biaya: ${service.estimated_cost}` : '',
      service.mode === 'online' || service.mode === 'both'
        ? '- Pengajuan bisa dilakukan online.'
        : '- Pengajuan saat ini diproses offline di kantor desa.',
      requirementLines.length > 0 ? `- Syarat utama:\n${requirementLines.join('\n')}` : '',
      service.mode === 'online' || service.mode === 'both'
        ? 'Kalau Bapak/Ibu mau, saya bisa kirim link formulirnya.'
        : 'Kalau perlu, saya bantu jelaskan langkah berikutnya ya.',
    ].filter(Boolean);
    return detailLines.join('\n');
  } catch {
    return null;
  }
}

export function tryHandleOutOfScopeGuard(input: {
  message: string;
  traceId: string;
  startTime: number;
}): ProcessMessageResult | null {
  if (OUT_OF_SCOPE_PUBLIC_SERVICE_PATTERN.test(input.message) && !/\b(lap|lay)-\d{8}-\d{3}\b/i.test(input.message)) {
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

  const reply = buildActiveServiceFollowUpReply(activeService, input.message, input.sideEffectMode)
    || await buildPendingServiceInfoReply(activeService.service_slug, activeService.village_id || input.villageId);

  if (!reply) {
    return null;
  }

  return buildGuardResult({
    startTime: input.startTime,
    traceId: input.traceId,
    response: reply,
    intent: 'SERVICE_INFO',
    hasKnowledge: true,
  });
}

interface PendingOfferInput {
  userId: string;
  message: string;
  channel: 'whatsapp' | 'webchat';
  villageId?: string;
  traceId: string;
  startTime: number;
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
    runWithMicroBudget,
  } = input;

  const pendingOffer = await getPendingServiceFormOfferWithFallback(userId);
  if (pendingOffer) {
    const hasLapLayCode = /\b(LAP|LAY)-\d{8}-\d{3}\b/i.test(message);
    if (hasLapLayCode) {
      clearPendingServiceFormOffer(userId);
    } else {
      if (detectServiceCorrectionReply(message)) {
        clearPendingServiceFormOffer(userId);
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

      if (isPendingServiceLinkRequest(message)) {
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

      if (isPendingServiceFollowUp(message) && !isClearlyDifferentIntent(message)) {
        const followUpReply = await buildPendingServiceInfoReply(pendingOffer.service_slug, pendingOffer.village_id || villageId);
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
  getUnifiedClassification: () => Promise<UnifiedClassifyResult | null>;
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
    getUnifiedClassification,
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
    const unified = await getUnifiedClassification();
    const isNewIntent = unified?.message_type === 'QUESTION' && unified.confidence >= 0.7;
    const isComplaint = unified?.message_type === 'COMPLAINT' && unified.confidence >= 0.7;
    const isGreeting = unified?.message_type === 'GREETING';
    const isFarewell = unified?.message_type === 'FAREWELL';
    const needsRAG = unified?.rag_needed === true && isNewIntent;

    if (isNewIntent || isComplaint || isGreeting || isFarewell || needsRAG) {
      clearPendingAddressRequest(userId);
    } else {
      const extractedAddr = await extractAddressFromMessage(message, userId, { village_id: pendingAddr.village_id });
      if (extractedAddr && extractedAddr.length >= 5) {
        clearPendingAddressRequest(userId);
        if (mediaUrl) addPendingPhoto(userId, mediaUrl);

        const complaintResult = await handleComplaintCreation(userId, channel, {
          fields: {
            village_id: pendingAddr.village_id,
            kategori: pendingAddr.kategori,
            deskripsi: pendingAddr.deskripsi,
            alamat: extractedAddr,
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

      if (message.trim().length > 10) {
        const addrAnalysis = await analyzeAddress(message.trim(), {
          village_id: pendingAddr.village_id,
          is_complaint_context: true,
          kategori: pendingAddr.kategori,
        });
        if (addrAnalysis?.quality === 'not_address') {
          return buildGuardResult({
            startTime,
            traceId,
            response: 'Mohon maaf Pak/Bu, saya belum bisa mengenali lokasi dari pesan tersebut. Bisa disebutkan alamat lengkapnya? Misalnya nama jalan, RT/RW, atau patokan terdekat.',
            intent: 'CREATE_COMPLAINT',
          });
        }

        clearPendingAddressRequest(userId);
        if (mediaUrl) addPendingPhoto(userId, mediaUrl);

        const complaintResult = await handleComplaintCreation(userId, channel, {
          fields: {
            village_id: pendingAddr.village_id,
            kategori: pendingAddr.kategori,
            deskripsi: pendingAddr.deskripsi,
            alamat: message.trim(),
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
    }
  }

  const pendingComplaint = await getPendingComplaintDataWithFallback(userId);
  if (pendingComplaint) {
    const unified = await getUnifiedClassification();
    const isNewIntent = unified?.message_type === 'QUESTION' && unified.confidence >= 0.7;
    const isComplaint = unified?.message_type === 'COMPLAINT' && unified.confidence >= 0.7;
    const isGreeting = unified?.message_type === 'GREETING';
    const isFarewell = unified?.message_type === 'FAREWELL';
    const needsRAG = unified?.rag_needed === true && isNewIntent;

    if (isNewIntent || isComplaint || isGreeting || isFarewell || needsRAG) {
      clearPendingComplaintData(userId);
    } else {
      const userProfile = await getAutoFillSuggestionsWithFallback(userId);

      if (pendingComplaint.waitingFor === 'nama') {
        const extractedName = await extractNameFromTextNLU(message, {
          village_id: villageId,
          wa_user_id: userId,
          session_id: userId,
          channel,
        });
        if (extractedName) {
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

      const phoneMatch = message.match(/\b(0[87]\d{8,11}|62[87]\d{8,11}|\+62[87]\d{8,11})\b/);
      if (phoneMatch) {
        const phone = phoneMatch[1].replace(/^\+/, '');
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

  const isEmergencyShortcut =
    !!villageId
    && EMERGENCY_PATTERN.test(message)
    && !EXPLICIT_REPORT_PATTERN.test(message)
    && !/\b(lap|lay)-\d{8}-\d{3}\b/i.test(message);

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

  const isComplaintInfoQuestion =
    COMPLAINT_INFO_QUERY_PATTERN.test(message)
    && COMPLAINT_INFO_HINT_PATTERN.test(message);
  const isServiceLikeReportMessage =
    /\blapor\b/i.test(message)
    && SERVICE_EVENT_PATTERN.test(message);
  const looksLikeComplaintShortcut =
    !/\b(lap|lay)-\d{8}-\d{3}\b/i.test(message)
    && !isComplaintInfoQuestion
    && !isServiceLikeReportMessage
    && !SERVICE_ADMIN_PATTERN.test(message)
    && (
      COMPLAINT_INCIDENT_PATTERN.test(message)
      || EXPLICIT_REPORT_PATTERN.test(message)
    );

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
  isClearlyDifferentIntent,
  buildOutOfScopeRedirect,
  buildActiveServiceFollowUpReply,
};
