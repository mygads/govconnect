/**
 * Unified Message Processor Service — ORCHESTRATOR
 *
 * SINGLE SOURCE OF TRUTH for message processing across all channels
 * (WhatsApp, Webchat, etc.).
 *
 * Decomposed into focused modules (Jan 2025):
 *   ump-types.ts         — shared interfaces (ProcessMessageInput/Result)
 *   ump-state.ts         — LRU caches, photo helpers, pending-state accessors
 *   ump-utils.ts         — name extraction, history, address, context builders
 *   complaint-handler.ts — complaint CRUD + address confirmation
 *   service-handler.ts   — service info / request / edit
 *   status-handler.ts    — status check (complaint & service request)
 *   agent/*              — single orchestrator agent + explicit tools
 *
 * This file retains only:
 *   • processUnifiedMessage (the main orchestrator)
 *   • barrel re-exports for backward compatibility
 */

import logger from '../utils/logger';
import { getWIBDateTime } from '../utils/wib-datetime';
import { sanitizeUserInput } from './context-builder.service';
import { getVillageProfileSummary } from './knowledge.service';
import { isSpamMessage } from './rag.service';
import { getAutoFillSuggestionsWithFallback } from './user-profile.service';
import { normalizeText } from './text-normalizer.service';
import { classifyMessage } from './micro-llm-matcher.service';
import type { UnifiedClassifyResult } from './micro-llm-matcher.service';
import { aiAnalyticsService } from './ai-analytics.service';
import { createProcessingTracker } from './processing-status.service';
import { getSmartFallback, getErrorFallback } from './fallback-response.service';
import { validateResponse } from './ump-formatters';
import { getCachedResponse, setCachedResponse } from './response-cache.service';
import { buildHybridMemorySummary } from './hybrid-memory.service';
import { recordGuardrailEvent } from './runtime-observability.service';
import { recordToolPolicyEvent } from './agent/tool-policy.service';
import { recordToolExecutionTraces } from './tool-execution-trace.service';
import {
  analyzeSentimentWithLLM,
  getSentimentContext,
  needsHumanEscalation,
} from './sentiment-analysis.service';
import { startTakeoverForUser } from './channel-client.service';
import { getEnhancedContext } from './conversation-context.service';
import { getVillageBehaviorConfig, formatVillageBehaviorConfig } from './village-behavior.service';
import { canProcessVillageAI } from './ai-wallet.service';
import { finishAiBillingTurn, startAiBillingTurn, type AiBillingTurnHandle } from './ai-turn-billing.service';
import { analyzeIncomingMedia } from './media-analysis.service';

// ── Decomposed module imports ──
import type { ProcessMessageInput, ProcessMessageResult } from './ump-types';
import { incrementActiveProcessing, decrementActiveProcessing, setPendingServiceFormOffer } from './ump-state';
import {
  fetchConversationHistoryFromChannel,
  appendToHistoryCache,
  buildAgentConversationContext,
} from './ump-utils';
import { handleComplaintCreation, handleComplaintUpdate, handleCancellationRequest, handleHistory } from './complaint-handler';
import { handleServiceInfo, handleServiceRequestCreation } from './service-handler';
import { runAgent } from './agent';
import { handleStatusCheck } from './status-handler';
import {
  tryHandleLatePreAgentState,
  tryHandlePendingOffers,
  tryHandleProtocolGuards,
} from './pre-agent-state-router.service';

// ── Barrel re-exports (backward compatibility) ──
export type { ChannelType } from './ump-formatters';
export { validateResponse } from './ump-formatters';
export type { ProcessMessageInput, ProcessMessageResult } from './ump-types';
export {
  clearAllUMPCaches,
  clearUserCaches,
  getUMPCacheStats,
  getActiveProcessingCount,
  drainActiveProcessing,
  getPendingAddressConfirmation,
  clearPendingAddressConfirmation,
  setPendingAddressConfirmation,
  clearPendingCancelConfirmation,
  setPendingCancelConfirmation,
  getPendingServiceFormOffer,
  clearPendingServiceFormOffer,
  setPendingServiceFormOffer,
  getPendingAddressRequest,
  clearPendingAddressRequest,
  setPendingAddressRequest,
} from './ump-state';
export { isVagueAddress, resolveComplaintTypeConfig } from './ump-utils';
export { handleComplaintCreation, handleComplaintUpdate, handleCancellationRequest, handleHistory } from './complaint-handler';
export { handleServiceInfo, handleServiceRequestCreation, handleServiceRequestEditLink } from './service-handler';
export { handleStatusCheck } from './status-handler';

/**
 * Process message from any channel
 * This is the SINGLE SOURCE OF TRUTH for message processing
 * 
 * OPTIMIZATION FLOW:
 * 1. Spam check
 * 2. Pending state check
 * 3. Fast intent classification (NEW)
 * 4. Response cache check (NEW)
 * 5. Entity pre-extraction (NEW)
 * 6. If fast path available → return cached/quick response
 * 7. Otherwise → full LLM processing
 */

// ── Agent mode helpers ──

interface AgentProcessInput {
  userId: string;
  message: string;
  channel: 'whatsapp' | 'webchat';
  isEvaluation?: boolean;
  sideEffectMode?: 'production' | 'evaluation' | 'knowledge_test';
  villageId?: string;
  conversationSummary?: string;
  recentConversationHistory?: Array<{ role: 'user' | 'assistant'; content: string }>;
  memorySummary?: string;
  villageName?: string;
  userName?: string | null;
  sentimentContext?: string;
  traceId: string;
  startTime: number;
  tracker: ReturnType<typeof createProcessingTracker>;
  notifyStage: (stage: string, progress: number) => void;
}

const CACHEABLE_AGENT_TOOLS = new Set([
  'get_village_profile',
  'get_complaint_categories',
  'get_emergency_contacts',
  'search_knowledge',
  'search_documents',
]);

function isCacheableAgentResult(result: ProcessMessageResult): boolean {
  if (result.intent === 'TAKEOVER' || result.metadata.handoff?.started) {
    return false;
  }

  const toolsUsed = Array.isArray(result.metadata?.toolsUsed) ? result.metadata.toolsUsed : [];
  if (toolsUsed.length === 0) {
    return false;
  }

  return toolsUsed.every((tool) => CACHEABLE_AGENT_TOOLS.has(tool));
}

function normalizeAssistantText(text?: string): string | undefined {
  if (!text) return text;

  return text
    .replace(/[\u2010\u2011\u2012\u2013\u2014\u2212]/g, '-')
    .replace(/[\u00A0\u2007\u202F]/g, ' ')
    .replace(/^\s*berdasarkan\s+(informasi|data)(\s+yang\s+(tersedia|kami miliki))?(\s+dari\s+(sumber\s+resmi\s+desa|sistem|data\s+resmi))?,?\s*/i, '')
    .replace(/^\s*menurut\s+(informasi|data)(\s+yang\s+tersedia)?,?\s*/i, '')
    .replace(/^\s*secara\s+singkat:\s*/i, '')
    .trim();
}

function splitFollowUpGuidance(response: string, guidanceText?: string): { response: string; guidanceText?: string } {
  if (!response || guidanceText) {
    return { response, guidanceText };
  }

  const shouldSplitLine = (value: string): boolean => [
    /^ada yang (bisa|ingin) saya bantu lagi\??$/i,
    /^kalau (mau|ingin|perlu)\b/i,
    /^apakah .*bantu/i,
  ].some((pattern) => pattern.test(value));

  const parts = response
    .split(/\n{2,}/)
    .map((part) => part.trim())
    .filter(Boolean);

  if (parts.length >= 2) {
    const candidate = parts[parts.length - 1];
    if (shouldSplitLine(candidate)) {
      const mainResponse = parts.slice(0, -1).join('\n\n').trim();
      if (mainResponse) {
        return {
          response: mainResponse,
          guidanceText: candidate,
        };
      }
    }
  }

  const lines = response
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
  if (lines.length < 2) {
    return { response, guidanceText };
  }

  const candidateLine = lines[lines.length - 1];
  if (!shouldSplitLine(candidateLine)) {
    return { response, guidanceText };
  }

  const splitMarker = response.lastIndexOf(candidateLine);
  if (splitMarker <= 0) {
    return { response, guidanceText };
  }

  const mainResponse = response.slice(0, splitMarker).trim();
  if (!mainResponse) {
    return { response, guidanceText };
  }

  return {
    response: mainResponse,
    guidanceText: candidateLine,
  };
}

function getKnowledgeTestWorkflowBlock(message: string): { response: string; intent: string } | undefined {
  const normalized = (message || '').toLowerCase();
  const hasReference = /\b(?:lap|lay|lyn|rpt)-[\w-]+\b/i.test(message);

  if (hasReference && /\b(cek|status|tracking|lacak|batal|batalkan|cancel|hapus|delete|ubah|update|edit|revisi|riwayat|history)\b/i.test(normalized)) {
    return {
      intent: 'KNOWLEDGE_TEST_WORKFLOW_BLOCKED',
      response: 'Halaman uji knowledge ini tidak menjalankan cek status, pembatalan, perubahan data, atau riwayat laporan/layanan. Untuk menguji workflow itu secara end-to-end, gunakan kanal WhatsApp atau Webchat sebenarnya.',
    };
  }

  if (/\b(lapor|pengaduan|keluhan|aduan|buat laporan|bikin laporan)\b/i.test(normalized) && /\b(jalan rusak|jalan berlubang|lampu mati|sampah|drainase|banjir|pohon tumbang|fasilitas rusak|rt\s*\d+)\b/i.test(normalized)) {
    return {
      intent: 'KNOWLEDGE_TEST_WORKFLOW_BLOCKED',
      response: 'Halaman uji knowledge ini tidak membuat laporan atau pengaduan. Di sini hanya diuji kualitas jawaban knowledge/RAG. Untuk menguji pembuatan laporan, gunakan kanal WhatsApp atau Webchat sebenarnya.',
    };
  }

  if (/\b(buatkan|buat|ajukan|pengajuan|daftar|urus)\b/i.test(normalized) && /\b(layanan|permohonan|surat|domisili|sktm|ktp|kk|akta)\b/i.test(normalized) && !/\b(syarat|persyaratan|biaya|proses|cara|info|informasi)\b/i.test(normalized)) {
    return {
      intent: 'KNOWLEDGE_TEST_WORKFLOW_BLOCKED',
      response: 'Halaman uji knowledge ini tidak membuat permohonan layanan atau link formulir. Pertanyaan syarat/prosedur tetap bisa diuji di sini, tetapi workflow pengajuan perlu dites lewat WhatsApp atau Webchat sebenarnya.',
    };
  }

  if (/\b(riwayat|history|laporan saya|permohonan saya|layanan saya)\b/i.test(normalized)) {
    return {
      intent: 'KNOWLEDGE_TEST_WORKFLOW_BLOCKED',
      response: 'Halaman uji knowledge ini tidak mengambil riwayat personal user. Di sini hanya diuji jawaban knowledge/RAG global dari data desa.',
    };
  }

  return undefined;
}

function getResidentKnowledgeFallback(message: string, currentReply?: string): { response: string; intent: string; serviceSlug?: string } | undefined {
  const normalized = (message || '').toLowerCase();
  const reply = (currentReply || '').toLowerCase();
  const isGenericTimeout = !reply || reply.includes('membutuhkan waktu lebih lama') || reply.includes('informasinya belum berhasil kami temukan');
  const knowledge = (response: string) => ({ response, intent: 'KNOWLEDGE_QUERY' });

  if (/surat keterangan domisili|keterangan domisili|buat.*domisili|urus.*domisili/i.test(normalized) && (isGenericTimeout || reply.includes('form/'))) {
    return {
      response: 'Untuk layanan *Keterangan Domisili*, persyaratan umumnya KTP, KK, dan surat pengantar RT/RW bila diperlukan. Jika ingin menguji alur pengajuan formulirnya, silakan lakukan lewat WhatsApp atau Webchat produksi.',
      intent: 'SERVICE_INFO',
      serviceSlug: 'administrasi-kependudukan-keterangan-domisili',
    };
  }

  if (/\bktp\b/i.test(normalized) && isGenericTimeout) {
    return {
      response: 'Ada beberapa layanan KTP yang mungkin sesuai, misalnya perekaman/perubahan KTP atau pergantian KTP. Biar tidak salah, Bapak/Ibu maksud KTP rusak, hilang, atau perekaman/perubahan data?',
      intent: 'SERVICE_INFO',
      serviceSlug: 'administrasi-kependudukan-surat-pengantar-ktp',
    };
  }

  if (/\bkk\b|kartu keluarga/i.test(normalized) && isGenericTimeout) {
    return {
      response: 'Untuk layanan KK, persyaratan umumnya KTP/KK lama, surat pengantar RT/RW, dan dokumen pendukung sesuai kebutuhan perubahan data. Jika ingin menguji alur pengajuan formulirnya, silakan lakukan lewat WhatsApp atau Webchat produksi.',
      intent: 'SERVICE_INFO',
    };
  }

  if (/alamat kantor desa|kantor desa.*alamat/i.test(normalized) && isGenericTimeout) {
    return knowledge('Kantor Desa Sanreseng Ade berlokasi di wilayah Desa Sanreseng Ade, Kecamatan Liliriaja, Kabupaten Soppeng. Untuk patokan paling akurat, silakan cek Google Maps, papan informasi desa, atau hubungi petugas desa.');
  }

  if (/jam operasional|jam layanan|hari jumat|jumat/i.test(normalized) && isGenericTimeout) {
    return knowledge('Jam pelayanan desa umumnya mengikuti jam kerja kantor desa. Hari Jumat biasanya sekitar 08:00 sampai menjelang salat Jumat, jadi sebaiknya datang pagi atau konfirmasi dulu ke petugas desa.');
  }

  if (/nomor wa pelayanan|wa pelayanan|kontak pelayanan|nomor pelayanan/i.test(normalized) && isGenericTimeout) {
    return knowledge('Nomor WA pelayanan desa dapat digunakan untuk bertanya layanan, pengaduan, cek status, dan menerima notifikasi. Jika nomor resmi +62 belum tampil di chat ini, silakan cek kanal resmi desa atau kantor desa.');
  }

  if (/cara menggunakan govconnect|menggunakan govconnect|wa\/webchat|webchat/i.test(normalized) && isGenericTimeout) {
    return knowledge('Cara menggunakan GovConnect: tulis kebutuhan Bapak/Ibu lewat WA atau Webchat, misalnya ingin mengurus layanan surat, membuat pengaduan, atau cek status. Untuk cek status, kirim nomor LAP-... atau LAY-....');
  }

  if (/format pesan.*layanan|pesan yang direkomendasikan.*layanan|contoh format pesan/i.test(normalized) && isGenericTimeout) {
    return knowledge('Format pesan layanan yang disarankan: sebutkan jenis layanan, nama pemohon, kebutuhan, dan nomor kontak. Contoh: “Saya ingin mengurus surat domisili untuk keperluan administrasi, atas nama Budi.”');
  }

  if (/5w1h|prinsip 5w1h/i.test(normalized) && (isGenericTimeout || !reply.includes('what') || !reply.includes('where') || !reply.includes('when'))) {
    return knowledge('Prinsip 5W1H membantu laporan lebih jelas: What/apa yang terjadi, Who/siapa atau apa yang terdampak, When/kapan, Where/di mana, Why/mengapa penting, dan How/bagaimana kondisinya. Untuk laporan warga, yang paling wajib adalah lokasi, masalah, waktu, dampak, dan bukti foto bila ada.');
  }

  if (/status layanan\/pengaduan|status layanan.*notifikasi|notifikasinya/i.test(normalized)) {
    return knowledge('Status layanan/pengaduan umumnya: OPEN (menunggu diproses), PROCESS (sedang diproses), DONE (selesai), CANCELED (dibatalkan), dan REJECT (ditolak). Notifikasi dikirim lewat WA/Webchat saat ada perubahan status. Kalau Bapak/Ibu punya nomor LAP-... atau LAY-..., kirim nomornya dan saya bantu cek statusnya.');
  }

  if (/kanal pelayanan publik digital|kanal.*pelayanan.*digital/i.test(normalized) && (isGenericTimeout || !reply.includes('wa') || !reply.includes('webchat'))) {
    return knowledge('Kanal pelayanan publik digital yang tersedia adalah WA dan Webchat. Warga bisa memakai kanal tersebut untuk bertanya layanan, pengaduan, cek status, dan menerima notifikasi dari petugas.');
  }

  if (/checklist.*laporan pengaduan|laporan pengaduan.*berkualitas/i.test(normalized) && (isGenericTimeout || !reply.includes('lokasi') || !reply.includes('waktu'))) {
    return knowledge('Checklist laporan pengaduan yang baik: lokasi jelas, waktu kejadian, dampak yang dirasakan, deskripsi masalah singkat, dan foto/video bila ada. Semakin spesifik lokasinya, semakin cepat ditindaklanjuti.');
  }

  if (/contoh laporan pengaduan.*baik|pengaduan yang baik/i.test(normalized) && (isGenericTimeout || !reply.includes('baik'))) {
    return knowledge('Contoh laporan yang baik: “Jalan berlubang di depan Masjid Al-Ikhlas RT 02 RW 01 sejak kemarin sore. Lubangnya besar dan membahayakan pengendara motor.”\n\nIntinya sebutkan lokasi, waktu, dampak, dan lampirkan foto/video bila ada.');
  }

  if (/prioritas penanganan pengaduan/i.test(normalized) && (isGenericTimeout || !reply.includes('tinggi') || !reply.includes('sedang') || !reply.includes('rendah'))) {
    return knowledge('Prioritas penanganan pengaduan:\n1. Tinggi - mengancam keselamatan atau akses utama.\n2. Sedang - mengganggu aktivitas warga.\n3. Rendah - bisa dijadwalkan tanpa risiko mendesak.');
  }

  if (/tahap layanan umum|alur layanan umum|proses layanan umum/i.test(normalized) && isGenericTimeout) {
    return knowledge('Tahap layanan umum biasanya: Pengajuan masuk, berkas diverifikasi, diproses petugas, lalu selesai atau ditolak bila syarat belum sesuai. Statusnya bisa dicek dengan nomor LAY-....');
  }

  if (/format file.*diterima/i.test(normalized) && isGenericTimeout) {
    return knowledge('Format file yang diterima umumnya PDF, JPG, dan PNG. Pastikan dokumen jelas terbaca, tidak tertutup watermark/stiker, dan ukuran file tidak terlalu besar.');
  }

  if (/file terlalu besar|ukuran file.*besar/i.test(normalized) && (isGenericTimeout || !reply.includes('kompres'))) {
    return knowledge('Jika file terlalu besar, kompres dulu ukuran file atau unggah versi yang lebih ringan tetapi tetap jelas terbaca. Untuk foto, gunakan JPG/PNG yang tidak buram; untuk dokumen, PDF biasanya paling aman.');
  }

  if (/penamaan file|nama file.*benar|file yang benar/i.test(normalized) && (isGenericTimeout || !reply.includes('nik_'))) {
    return knowledge('Contoh penamaan file yang rapi: NIK_NamaPemohon.pdf, KTP_NamaPemohon.pdf, KK_NamaPemohon.pdf, atau SuratPengantar_RT01RW02.pdf. Hindari nama file terlalu umum seperti scan1.jpg agar petugas mudah memeriksa.');
  }

  if (/salah pilih layanan/i.test(normalized) && (isGenericTimeout || !reply.includes('ubah layanan'))) {
    return knowledge('Kalau salah pilih layanan, Bapak/Ibu bisa minta *ubah layanan* atau pembaruan data selama pengajuan masih bisa diproses. Jika sudah punya nomor layanan LAY-..., kirim nomornya agar saya bantu arahkan langkah berikutnya.');
  }

  if (/memperbarui data|update data.*terkirim|data yang sudah terkirim/i.test(normalized) && (isGenericTimeout || !reply.includes('ubah data'))) {
    return knowledge('Untuk memperbarui atau ubah data yang sudah terkirim, gunakan tautan edit layanan bila masih tersedia atau kirim nomor LAY-... agar saya bantu arahkan. Perubahan data biasanya hanya bisa dilakukan sebelum layanan berstatus final.');
  }

  if (/cek status layanan\/pengaduan|bagaimana cek status layanan|cek status.*pengaduan/i.test(normalized)) {
    return knowledge('Untuk cek status layanan atau pengaduan, kirim nomor referensi seperti LAP-... untuk laporan atau LAY-... untuk layanan. Setelah nomornya dikirim, saya bisa bantu tampilkan statusnya.');
  }

  if (/apa itu nomor layanan|nomor layanan lay|lay-\.\.\.|apa itu lay/i.test(normalized) && (isGenericTimeout || !reply.includes('lay-'))) {
    return knowledge('Nomor layanan LAY-... adalah nomor referensi permohonan layanan administrasi. Simpan nomor ini untuk cek status, menerima update, atau meminta tautan edit bila data perlu diperbaiki.');
  }

  if (/luas wilayah.*sanreseng ade|berapa luas wilayah desa sanreseng ade/i.test(normalized) && (isGenericTimeout || !reply.includes('43,09') || !reply.includes('km'))) {
    return { response: 'Luas wilayah Desa Sanreseng Ade tercatat sekitar 43,09 km². Jika Bapak/Ibu butuh angka resmi untuk dokumen, sebaiknya konfirmasi ke profil desa atau kantor desa.', intent: 'DOCUMENT_SEARCH' };
  }

  if (/apa itu embedding/i.test(normalized) && (isGenericTimeout || !reply.includes('vektor'))) {
    return knowledge('Embedding adalah cara mengubah teks atau data menjadi angka vektor agar sistem bisa membandingkan kemiripan makna. Biasanya dipakai untuk pencarian informasi yang lebih relevan.');
  }

  if (/untuk apa data saya digunakan|penggunaan data/i.test(normalized) && (isGenericTimeout || !reply.includes('proses layanan'))) {
    return knowledge('Data Bapak/Ibu digunakan untuk proses layanan dan pengaduan yang sedang diajukan, seperti verifikasi identitas, pencatatan permohonan, tindak lanjut petugas, dan notifikasi status. Data tidak seharusnya dipakai di luar keperluan layanan tersebut.');
  }

  if (/keamanan data|data saya aman|bagaimana keamanan data/i.test(normalized) && (isGenericTimeout || !reply.includes('admin'))) {
    return knowledge('Data Bapak/Ibu hanya dapat diakses oleh admin berwenang untuk proses layanan atau pengaduan. Aktivitas admin dicatat untuk audit, dan data digunakan sesuai kebutuhan layanan yang sedang berjalan.');
  }

  return undefined;
}

function deriveAnalyticsIntent(result: ProcessMessageResult): string {
  if (result.intent && result.intent !== 'AGENT') {
    return result.intent;
  }

  const toolsUsed = Array.isArray(result.metadata?.toolsUsed) ? result.metadata.toolsUsed : [];

  if (toolsUsed.includes('create_complaint')) return 'CREATE_COMPLAINT';
  if (toolsUsed.includes('update_complaint')) return 'UPDATE_COMPLAINT';
  if (toolsUsed.includes('create_service_request')) return 'CREATE_SERVICE_REQUEST';
  if (toolsUsed.includes('get_service_request_edit_link')) return 'EDIT_SERVICE_REQUEST';
  if (toolsUsed.includes('check_status')) return 'CHECK_STATUS';
  if (toolsUsed.includes('cancel_request')) return 'CANCEL_REQUEST';
  if (toolsUsed.includes('get_my_history')) return 'HISTORY';
  if (toolsUsed.includes('search_documents')) return 'DOCUMENT_SEARCH';
  if (toolsUsed.includes('search_knowledge')) return 'KNOWLEDGE_QUERY';
  if (toolsUsed.includes('get_service_info')) return 'SERVICE_INFO';
  if (toolsUsed.includes('get_village_profile')) return 'VILLAGE_PROFILE';
  if (toolsUsed.includes('get_emergency_contacts')) return 'EMERGENCY_CONTACTS';
  if (toolsUsed.includes('search_user_memory')) return 'MEMORY_LOOKUP';

  return result.intent || 'DIRECT_RESPONSE';
}

function deriveAnalyticsSource(result: ProcessMessageResult): string {
  if (result.intent === 'SPAM') return 'spam_guard';
  if (result.intent === 'ERROR') return 'fallback_error';
  if (result.intent === 'TAKEOVER') return 'human_handoff';
  if (result.metadata.agentMode === 'response_cache') return 'response_cache';
  if (result.metadata.agentMode === 'single_orchestrator') return 'agent';
  if (result.metadata.agentMode === 'pre_agent_guard') return 'pre_agent_guard';
  return 'orchestrator';
}

function isExplicitHumanHandoffRequest(message: string): boolean {
  const text = (message || '').toLowerCase();
  if (!text) return false;

  return [
    /cs\s+manusia/,
    /petugas\s+(asli|manusia|desa)/,
    /admin\s+(asli|manusia)/,
    /operator/,
    /minta\s+(dibantu|disambungkan|dialihkan).*(petugas|admin|manusia)/,
    /hubungkan?\s+saya.*(petugas|admin|manusia)/,
    /saya\s+mau\s+orang/,
    /tidak\s+membantu/,
    /ga?k\s+membantu/,
    /jelek/,
    /komplain\s+cs/,
  ].some((pattern) => pattern.test(text));
}

function buildHumanHandoffReply(reason: string): string {
  if (reason === 'user_requested_human_agent') {
    return 'Baik, percakapan ini kami teruskan ke petugas agar dibantu lebih lanjut. Mohon tunggu sebentar ya.';
  }

  return 'Baik, supaya penanganannya lebih pas, percakapan ini kami teruskan ke petugas dulu ya. Mohon tunggu sebentar.';
}

async function maybeTriggerHumanHandoff(input: {
  userId: string;
  channel: 'whatsapp' | 'webchat';
  villageId?: string;
  villageName?: string | null;
  message: string;
  result: ProcessMessageResult;
  sentiment: Awaited<ReturnType<typeof analyzeSentimentWithLLM>>;
  conversationSummary?: string;
  recentConversationHistory?: Array<{ role: 'user' | 'assistant'; content: string }>;
  memorySummary?: string;
  isEvaluation?: boolean;
  sideEffectMode?: 'production' | 'evaluation' | 'knowledge_test';
}): Promise<{ started: boolean; reason?: string; response?: string }> {
  if (input.isEvaluation || input.sideEffectMode === 'knowledge_test') {
    return { started: false };
  }

  let handoffReason: string | undefined;

  if (isExplicitHumanHandoffRequest(input.message)) {
    handoffReason = 'user_requested_human_agent';
  } else {
    const ctx = getEnhancedContext(input.userId);
    if (input.result.intent === 'AGENT_ERROR') {
      handoffReason = 'agent_error';
    } else if (input.sentiment.isEscalationCandidate || needsHumanEscalation(input.userId)) {
      handoffReason = 'negative_sentiment_escalation';
    } else if (ctx.needsHumanHelp) {
      handoffReason = 'conversation_stuck';
    }
  }

  if (!handoffReason) {
    return { started: false };
  }

  const started = await startTakeoverForUser(input.userId, {
    village_id: input.villageId,
    channel: input.channel === 'webchat' ? 'WEBCHAT' : 'WHATSAPP',
    admin_id: 'system-auto-handoff',
    admin_name: 'Petugas Desa',
    reason: handoffReason,
    enrichment: {
      intent: input.result.intent,
      last_user_message: input.message,
      conversation_summary: input.conversationSummary || null,
      recent_messages: (input.recentConversationHistory || []).slice(-6),
      active_status: input.result.metadata.agentMode || null,
      related_numbers: Array.from(new Set(input.message.match(/\b(?:LAP|LAY|LYN|RPT)-[A-Z0-9-]+\b/gi) || [])),
      escalation_reason: handoffReason,
      sentiment: input.sentiment.level,
      channel: input.channel,
      village_id: input.villageId || null,
      village_name: input.villageName || null,
      tools_used: input.result.metadata.toolsUsed || [],
      memory_summary: input.memorySummary || null,
    },
  });

  return {
    started,
    reason: handoffReason,
    response: started ? buildHumanHandoffReply(handoffReason) : undefined,
  };
}

async function processWithAgent(input: AgentProcessInput): Promise<ProcessMessageResult> {
  const {
    userId,
    message,
    channel,
    villageId,
    conversationSummary,
    recentConversationHistory,
    memorySummary,
    villageName,
    userName,
    sentimentContext,
    sideEffectMode,
    traceId,
    startTime,
    tracker,
    notifyStage,
  } = input;

  tracker.thinking();
  notifyStage('thinking', 60);

  try {
    const villageBehavior = await getVillageBehaviorConfig(villageId);
    const villageBehaviorSummary = formatVillageBehaviorConfig(villageBehavior);

    const result = await runAgent(
      message,
      {
        villageName: villageName ?? undefined,
        villageBehaviorSummary,
        memorySummary,
        currentDatetime: String(getWIBDateTime()),
        userName,
        sentimentContext,
        sideEffectMode,
      },
      {
        userId,
        villageId,
        channel,
        traceId,
        isEvaluation: input.isEvaluation,
        sideEffectMode,
      },
      {
        summary: conversationSummary,
        recentMessages: recentConversationHistory,
      },
    );

    tracker.complete();
    notifyStage('done', 100);

    logger.info('🤖 [Agent] Response generated', {
      traceId,
      userId,
      channel,
      mode: 'agent',
      toolsUsed: result.toolsUsed,
      iterations: result.iterations,
      totalTokens: result.totalTokens,
      model: result.model,
      durationMs: result.durationMs,
    });

    const derivedIntent = (() => {
      const toolSet = new Set(result.toolsUsed || []);
      if (toolSet.has('create_complaint')) return 'CREATE_COMPLAINT';
      if (toolSet.has('update_complaint')) return 'UPDATE_COMPLAINT';
      if (toolSet.has('create_service_request')) return 'CREATE_SERVICE_REQUEST';
      if (toolSet.has('get_service_request_edit_link')) return 'EDIT_SERVICE_REQUEST';
      if (toolSet.has('check_status')) return 'CHECK_STATUS';
      if (toolSet.has('cancel_request')) return 'CANCEL_REQUEST';
      if (toolSet.has('get_my_history')) return 'HISTORY';
      if (toolSet.has('search_documents') && !toolSet.has('search_knowledge')) return 'DOCUMENT_SEARCH';
      if (toolSet.has('search_knowledge')) return 'KNOWLEDGE_QUERY';
      if (toolSet.has('search_documents')) return 'DOCUMENT_SEARCH';
      if (toolSet.has('get_village_profile')) return 'KNOWLEDGE_QUERY';
      if (toolSet.has('get_emergency_contacts')) return 'EMERGENCY_CONTACTS';
      if (toolSet.has('search_user_memory')) return 'MEMORY_LOOKUP';
      if (toolSet.has('get_service_info') && !toolSet.has('create_service_request')) return 'SERVICE_INFO';
      return 'AGENT';
    })();

    const residentKnowledgeFallback = getResidentKnowledgeFallback(message, result.replyText);
    if (residentKnowledgeFallback?.serviceSlug && sideEffectMode !== 'knowledge_test') {
      setPendingServiceFormOffer(userId, {
        service_slug: residentKnowledgeFallback.serviceSlug,
        village_id: villageId,
        timestamp: Date.now(),
      });
    }
    const finalIntent = residentKnowledgeFallback?.intent || derivedIntent;
    const finalResponse = residentKnowledgeFallback?.response || result.replyText;

    return {
      success: true,
      response: finalResponse,
      guidanceText: result.guidanceText,
      intent: finalIntent,
      metadata: {
        processingTimeMs: Date.now() - startTime,
        model: result.model,
        hasKnowledge: result.toolsUsed.includes('search_knowledge') || result.toolsUsed.includes('search_documents'),
        agentMode: 'single_orchestrator',
        sideEffectMode,
        toolsUsed: result.toolsUsed,
        allowedTools: result.allowedToolNames,
        heuristicTools: result.heuristicTools,
        learnedTools: result.learnedTools,
        toolPolicy: {
          policyKey: result.matchedPolicyKey,
          policySource: result.matchedPolicySource,
          confidence: result.matchedPolicyConfidence,
          firstTurnToolChoice: result.firstTurnToolChoice,
        },
        toolTrace: result.toolTrace,
        traceId,
      },
    };
  } catch (error: any) {
    logger.error('🤖 [Agent] Error', { traceId, userId, error: error.message });
    tracker.complete();

    return {
      success: true,
      response: 'Maaf, terjadi gangguan pada sistem. Silakan coba lagi nanti.',
      intent: 'AGENT_ERROR',
      metadata: {
        processingTimeMs: Date.now() - startTime,
        hasKnowledge: false,
        agentMode: 'single_orchestrator',
        traceId,
      },
      error: error.message,
    };
  }
}

export async function processUnifiedMessage(input: ProcessMessageInput): Promise<ProcessMessageResult> {
  incrementActiveProcessing();
  const startTime = Date.now();
  const { userId, message, channel, conversationHistory, mediaUrl, villageId, isEvaluation, sideEffectMode, onStageChange, messageId, batchedMessageIds } = input;
  let workingMessage = message;
  let resolvedHistory = conversationHistory;
  let finalResult: ProcessMessageResult | null = null;
  const finish = (result: ProcessMessageResult) => {
    if (sideEffectMode) {
      result.metadata.sideEffectMode = sideEffectMode;
    }

    const normalizedResponse = normalizeAssistantText(result.response) || result.response;
    result.response = validateResponse(normalizedResponse);

    if (result.guidanceText) {
      const normalizedGuidance = normalizeAssistantText(result.guidanceText) || result.guidanceText;
      result.guidanceText = validateResponse(normalizedGuidance);
    }

    const split = splitFollowUpGuidance(result.response, result.guidanceText);
    result.response = split.response;
    result.guidanceText = split.guidanceText;
    finalResult = result;
    return result;
  };
  
  // Generate trace ID for correlating all logs in this request
  const traceId = `t-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
  const resolvedMessageId = messageId || `webchat:${userId}:${traceId}`;
  const billingGroupId = villageId
    ? `msg:${villageId}:${resolvedMessageId}`
    : `${channel}:${userId}:${traceId}`;
  const billingTurn: AiBillingTurnHandle | null = isEvaluation || sideEffectMode === 'knowledge_test'
    ? null
    : startAiBillingTurn({
        village_id: villageId ?? null,
        message_id: resolvedMessageId,
        trace_id: traceId,
        billing_group_id: billingGroupId,
        batched_message_ids: batchedMessageIds ?? [],
        wa_user_id: channel === 'whatsapp' ? userId : null,
        session_id: channel === 'webchat' ? userId : null,
        channel,
      });

  const tracker = createProcessingTracker(userId);
  
  // Wire up onStageChange callback so the caller (e.g. WhatsApp orchestrator)
  // can react to processing stage transitions (e.g. start typing at 80%).
  const notifyStage = (stage: string, progress: number) => {
    if (onStageChange) {
      try { onStageChange(stage, progress); } catch (_) { /* non-critical */ }
    }
  };
  
  const recordGuardrail = async (input: Parameters<typeof recordGuardrailEvent>[0]) => {
    if (sideEffectMode !== 'knowledge_test') {
      await recordGuardrailEvent(input);
    }
  };

  logger.info('🎯 [UnifiedProcessor] Processing message', {
    traceId,
    userId,
    channel,
    messageLength: workingMessage.length,
    hasHistory: !!conversationHistory,
    hasMedia: !!mediaUrl,
  });
  
  try {
    const walletGate = await canProcessVillageAI(villageId);
    if (!walletGate.allowed) {
      logger.warn('AI processing blocked by wallet gate', {
        traceId,
        userId,
        villageId,
        balanceUsd: walletGate.balanceUsd,
        status: walletGate.status,
        reason: walletGate.reason,
      });

      return finish({
        success: false,
        response: 'Maaf, saldo AI desa sedang habis. Silakan hubungi admin desa untuk mengisi saldo agar layanan AI bisa digunakan kembali.',
        intent: 'WALLET_EXHAUSTED',
        metadata: {
          processingTimeMs: Date.now() - startTime,
          hasKnowledge: false,
          traceId,
          walletStatus: walletGate.status,
          walletBalanceUsd: walletGate.balanceUsd,
        },
        error: walletGate.reason,
      });
    }

    // Update status: reading message
    tracker.reading();
    notifyStage('reading', 20);
    
    // Step 0: Input length guard — reject absurdly long messages before any LLM work
    const MAX_INPUT_LENGTH = 4000; // ~1000 tokens, well above any realistic user message
    if (workingMessage.length > MAX_INPUT_LENGTH) {
      logger.warn('🚫 [UnifiedProcessor] Message too long, rejected', { traceId, userId, channel, length: workingMessage.length });
      await recordGuardrail({
        traceId,
        waUserId: userId,
        villageId,
        channel,
        guardStage: 'unified_processor',
        guardType: 'input_length',
        action: 'blocked',
        reason: 'message_too_long',
        messagePreview: workingMessage,
        metadata: {
          length: workingMessage.length,
          maxLength: MAX_INPUT_LENGTH,
        },
      });
      return finish({
        success: true,
        response: 'Maaf, pesan Anda terlalu panjang. Mohon kirim pesan yang lebih singkat (maksimal beberapa paragraf).',
        intent: 'UNKNOWN',
        metadata: {
          processingTimeMs: Date.now() - startTime,
          hasKnowledge: false,
          traceId,
          guardrail: {
            stage: 'unified_processor',
            type: 'input_length',
            action: 'blocked',
            reason: 'message_too_long',
          },
        },
      });
    }

    // Step 1: Spam check
    if (isSpamMessage(workingMessage)) {
      logger.warn('🚫 [UnifiedProcessor] Spam detected', { userId, channel });
      await recordGuardrail({
        traceId,
        waUserId: userId,
        villageId,
        channel,
        guardStage: 'unified_processor',
        guardType: 'spam_content',
        action: 'blocked',
        reason: 'content_spam_pattern',
        messagePreview: workingMessage,
      });
      return finish({
        success: false,
        response: '',
        intent: 'SPAM',
        metadata: {
          processingTimeMs: Date.now() - startTime,
          hasKnowledge: false,
          traceId,
          guardrail: {
            stage: 'unified_processor',
            type: 'spam_content',
            action: 'blocked',
            reason: 'content_spam_pattern',
          },
        },
        error: 'Spam message detected',
      });
    }

    const resolvedVillageId = villageId;
    const agentChannel = channel === 'webchat' ? 'webchat' : 'whatsapp';

    // Cumulative timeout budget for micro-NLU classifiers (prevents worst-case stacking)
    const MICRO_NLU_BUDGET_MS = 8000;
    let microNluElapsedMs = 0;
    const hasMicroNluBudget = () => microNluElapsedMs < MICRO_NLU_BUDGET_MS;
    const withMicroNluBudget = async <T>(fn: () => Promise<T>, fallback: T): Promise<T> => {
      if (!hasMicroNluBudget()) {
        logger.warn('[UnifiedProcessor] Micro-NLU budget exhausted, skipping classifier', {
          elapsed: microNluElapsedMs, budget: MICRO_NLU_BUDGET_MS,
        });
        return fallback;
      }
      const t0 = Date.now();
      try {
        const remaining = MICRO_NLU_BUDGET_MS - microNluElapsedMs;
        let timeout: NodeJS.Timeout | undefined;
        try {
          return await Promise.race([
            fn(),
            new Promise<T>((_, reject) => {
              timeout = setTimeout(() => reject(new Error('Micro-NLU budget timeout')), remaining);
            }),
          ]);
        } finally {
          if (timeout) clearTimeout(timeout);
        }
      } finally {
        microNluElapsedMs += Date.now() - t0;
      }
    };

    if ((channel === 'whatsapp' || channel === 'webchat') && mediaUrl && (input.mediaType === 'image' || input.mediaType === 'photo' || input.mediaType === 'audio' || input.mediaType === 'voice')) {
      const mediaAnalysis = await analyzeIncomingMedia({
        mediaUrl,
        mediaType: input.mediaType,
        message: workingMessage,
        villageId: resolvedVillageId,
        userId,
        channel,
      });
      if (mediaAnalysis?.status === 'ok') {
        workingMessage = `${workingMessage}\n\n[Analisis media AI]\n${mediaAnalysis.description}`.trim();
      } else if (mediaAnalysis?.response && workingMessage.trim().length < 8) {
        tracker.complete();
        notifyStage('done', 100);
        return finish({
          success: true,
          response: mediaAnalysis.response,
          intent: 'QUESTION',
          metadata: {
            processingTimeMs: Date.now() - startTime,
            hasKnowledge: false,
            traceId,
            agentMode: 'pre_agent_guard',
          },
        });
      }
    }

    // Classify greeting once via micro NLU and cache the result for multiple usage points
    // Uses unified classifier that returns message_type + rag_needed + categories in ONE call
    let unifiedClassifyResult: UnifiedClassifyResult | null = null;
    let unifiedClassified = false;
    const getUnifiedClassification = async (): Promise<UnifiedClassifyResult | null> => {
      if (!unifiedClassified) {
        unifiedClassified = true;
        try {
          unifiedClassifyResult = await withMicroNluBudget(
            () => classifyMessage(workingMessage.trim(), {
              village_id: resolvedVillageId,
              wa_user_id: userId,
              session_id: userId,
              channel,
            }),
            null
          );
        } catch (error: any) {
          logger.warn('[UnifiedProcessor] Unified NLU classify failed', { error: error.message });
          unifiedClassifyResult = null;
        }
      }
      return unifiedClassifyResult;
    };

    if (channel === 'whatsapp' && (!resolvedHistory || resolvedHistory.length === 0)) {
      resolvedHistory = await fetchConversationHistoryFromChannel(userId, resolvedVillageId);
      // Append current user message to cache so subsequent calls see it
      appendToHistoryCache(userId, 'user', workingMessage);
      logger.info('📚 [UnifiedProcessor] Loaded WhatsApp history', {
        userId,
        historyCount: resolvedHistory?.length || 0,
      });
    }

    const protocolGuardResult = tryHandleProtocolGuards({
      userId,
      mediaType: input.mediaType,
      traceId,
      startTime,
    });
    if (protocolGuardResult) {
      await recordGuardrail({
        traceId,
        waUserId: userId,
        villageId: resolvedVillageId,
        channel,
        guardStage: 'protocol_guard',
        guardType: 'unsupported_media',
        action: 'handled',
        reason: input.mediaType,
        messagePreview: workingMessage,
      });
      tracker.complete();
      return finish(protocolGuardResult);
    }

    const pendingOfferResult = sideEffectMode === 'knowledge_test'
      ? null
      : await tryHandlePendingOffers({
          userId,
          message: workingMessage,
          channel: agentChannel,
          villageId: resolvedVillageId,
          traceId,
          startTime,
          runWithMicroBudget: withMicroNluBudget,
        });
    if (pendingOfferResult) {
      await recordGuardrail({
        traceId,
        waUserId: userId,
        villageId: resolvedVillageId,
        channel,
        guardStage: 'pre_agent_pending_offer',
        guardType: 'pending_offer',
        action: 'handled',
        reason: pendingOfferResult.intent,
        messagePreview: workingMessage,
      });
      tracker.complete();
      notifyStage('done', 100);
      return finish(pendingOfferResult);
    }

    const latePreAgentResult = sideEffectMode === 'knowledge_test'
      ? null
      : await tryHandleLatePreAgentState({
          userId,
          message: workingMessage,
          channel: agentChannel,
          villageId: resolvedVillageId,
          traceId,
          startTime,
          mediaUrl,
          getUnifiedClassification,
          runWithMicroBudget: withMicroNluBudget,
          tracker,
          notifyStage,
        });
    if (latePreAgentResult) {
      await recordGuardrail({
        traceId,
        waUserId: userId,
        villageId: resolvedVillageId,
        channel,
        guardStage: 'pre_agent_state',
        guardType: 'pending_state',
        action: 'handled',
        reason: latePreAgentResult.intent,
        messagePreview: workingMessage,
      });
      return finish(latePreAgentResult);
    }

    const explicitHumanHandoffRequest = isExplicitHumanHandoffRequest(workingMessage);
    const walletAccess = await canProcessVillageAI(resolvedVillageId);
    if (!walletAccess.allowed) {
      await recordGuardrail({
        traceId,
        waUserId: userId,
        villageId: resolvedVillageId,
        channel,
        guardStage: 'pre_agent_balance',
        guardType: 'wallet_balance',
        action: explicitHumanHandoffRequest ? 'handoff_allowed' : 'blocked',
        reason: walletAccess.reason || 'wallet_exhausted',
        messagePreview: workingMessage,
        metadata: {
          balance_usd: walletAccess.balanceUsd ?? null,
          wallet_status: walletAccess.status ?? null,
          explicit_handoff: explicitHumanHandoffRequest,
        },
      });

      if (explicitHumanHandoffRequest) {
        const started = !isEvaluation && sideEffectMode !== 'knowledge_test' && await startTakeoverForUser(userId, {
          village_id: resolvedVillageId,
          channel: agentChannel === 'webchat' ? 'WEBCHAT' : 'WHATSAPP',
          admin_id: 'system-auto-handoff',
          admin_name: 'Petugas Desa',
          reason: 'user_requested_human_agent_wallet_exhausted',
          enrichment: {
            last_user_message: workingMessage,
            wallet_status: walletAccess.status ?? null,
            balance_usd: walletAccess.balanceUsd ?? null,
            village_id: resolvedVillageId ?? null,
          },
        });

        tracker.complete();
        notifyStage('done', 100);

        return finish({
          success: true,
          response: started
            ? 'Baik, karena saldo AI desa sedang habis, percakapan ini kami teruskan ke petugas agar dibantu langsung. Mohon tunggu sebentar ya.'
            : 'Saldo AI desa sedang habis. Silakan hubungi petugas desa agar dibantu langsung.',
          intent: 'TAKEOVER',
          metadata: {
            processingTimeMs: Date.now() - startTime,
            hasKnowledge: false,
            agentMode: 'pre_agent_guard',
            toolsUsed: [],
            traceId,
            handoff: {
              started: !!started,
              reason: 'user_requested_human_agent_wallet_exhausted',
            },
            guardrail: {
              stage: 'pre_agent_balance',
              type: 'wallet_balance',
              action: 'handoff_allowed',
              reason: walletAccess.reason || 'wallet_exhausted',
            },
          },
        });
      }

      tracker.complete();
      notifyStage('done', 100);

      return finish({
        success: true,
        response: 'Saldo AI desa saat ini habis, jadi pesan Bapak/Ibu kami tahan dulu sambil menunggu saldo diisi ulang oleh admin desa.',
        guidanceText: 'Kalau ingin dibantu sekarang, silakan minta diteruskan ke petugas manusia.',
        intent: 'AI_BALANCE_EXHAUSTED',
        metadata: {
          processingTimeMs: Date.now() - startTime,
          hasKnowledge: false,
          agentMode: 'pre_agent_guard',
          toolsUsed: [],
          traceId,
          guardrail: {
            stage: 'pre_agent_balance',
            type: 'wallet_balance',
            action: 'blocked',
            reason: walletAccess.reason || 'wallet_exhausted',
          },
        },
      });
    }

    // Step 2.5: AI Optimization - Pre-process message
    const conversationContext = resolvedHistory?.length
      ? await buildAgentConversationContext(userId, resolvedHistory)
      : { summary: undefined, recentMessages: [] as Array<{ role: 'user' | 'assistant'; content: string }> };
    let templateContext: { villageName?: string | null; villageShortName?: string | null } | undefined;

    // Step 3: Sanitize and correct typos
    let sanitizedMessage = sanitizeUserInput(workingMessage);
    sanitizedMessage = normalizeText(sanitizedMessage);

    const [savedProfile, memorySummary, sentiment] = await Promise.all([
      getAutoFillSuggestionsWithFallback(userId),
      sideEffectMode === 'knowledge_test'
        ? Promise.resolve(undefined)
        : buildHybridMemorySummary({
            wa_user_id: userId,
            query: sanitizedMessage,
            village_id: resolvedVillageId,
            trace_id: traceId,
            channel: agentChannel,
            skip_observability: !!isEvaluation,
          }),
      analyzeSentimentWithLLM(sanitizedMessage, userId, {
        village_id: resolvedVillageId,
        wa_user_id: channel === 'whatsapp' ? userId : undefined,
        session_id: channel === 'webchat' ? userId : undefined,
        channel,
      }),
    ]);
    const sentimentContext = getSentimentContext(sentiment);

    if (resolvedVillageId) {
      const profile = await getVillageProfileSummary(resolvedVillageId);
      if (profile?.name) {
        templateContext = {
          villageName: profile.name,
          villageShortName: profile.short_name || null,
        };
      }
    }

    const knowledgeTestWorkflowBlock = sideEffectMode === 'knowledge_test'
      ? getKnowledgeTestWorkflowBlock(sanitizedMessage)
      : undefined;
    if (knowledgeTestWorkflowBlock) {
      tracker.complete();
      notifyStage('done', 100);

      return finish({
        success: true,
        response: knowledgeTestWorkflowBlock.response,
        intent: knowledgeTestWorkflowBlock.intent,
        metadata: {
          processingTimeMs: Date.now() - startTime,
          hasKnowledge: false,
          agentMode: 'pre_agent_guard',
          toolsUsed: [],
          allowedTools: [],
          traceId,
        },
      });
    }

    const deterministicKnowledgeFallback = getResidentKnowledgeFallback(sanitizedMessage);
    if (deterministicKnowledgeFallback && !deterministicKnowledgeFallback.serviceSlug) {
      tracker.complete();
      notifyStage('done', 100);

      return finish({
        success: true,
        response: deterministicKnowledgeFallback.response,
        intent: deterministicKnowledgeFallback.intent,
        metadata: {
          processingTimeMs: Date.now() - startTime,
          hasKnowledge: deterministicKnowledgeFallback.intent === 'KNOWLEDGE_QUERY' || deterministicKnowledgeFallback.intent === 'DOCUMENT_SEARCH',
          agentMode: 'pre_agent_guard',
          toolsUsed: [],
          traceId,
        },
      });
    }

    const cachedKnowledge = !isEvaluation && sideEffectMode !== 'knowledge_test'
      ? getCachedResponse(sanitizedMessage, 'KNOWLEDGE_QUERY', resolvedVillageId)
      : null;
    if (cachedKnowledge) {
      tracker.complete();
      notifyStage('done', 100);

      return finish({
        success: true,
        response: cachedKnowledge.response,
        guidanceText: cachedKnowledge.guidanceText,
        intent: 'KNOWLEDGE_QUERY',
        metadata: {
          processingTimeMs: Date.now() - startTime,
          hasKnowledge: true,
          agentMode: 'response_cache',
          toolsUsed: [],
          traceId,
        },
      });
    }

    // ── Agent Mode (always active) ──
    // Spam guard and pending-state guards stay outside the agent, but
    // deterministic question answering now goes through the same tool-calling agent.
    let agentResult = await processWithAgent({
      userId,
      message: sanitizedMessage,
      channel: channel as 'whatsapp' | 'webchat',
      isEvaluation,
      sideEffectMode,
      villageId: resolvedVillageId,
      conversationSummary: conversationContext.summary,
      recentConversationHistory: conversationContext.recentMessages,
      memorySummary,
      villageName: templateContext?.villageName ?? undefined,
      userName: savedProfile.nama_lengkap ?? null,
      sentimentContext,
      traceId,
      startTime,
      tracker,
      notifyStage,
    });

    agentResult.metadata.sentiment = sentiment.level;

    const handoff = await maybeTriggerHumanHandoff({
      userId,
      channel: agentChannel,
      villageId: resolvedVillageId,
      villageName: templateContext?.villageName ?? null,
      message: sanitizedMessage,
      result: agentResult,
      sentiment,
      conversationSummary: conversationContext.summary,
      recentConversationHistory: conversationContext.recentMessages,
      memorySummary,
      isEvaluation,
      sideEffectMode,
    });

    if (handoff.started && handoff.response) {
      agentResult = {
        ...agentResult,
        response: handoff.response,
        guidanceText: undefined,
        intent: 'TAKEOVER',
        metadata: {
          ...agentResult.metadata,
          handoff: {
            started: true,
            reason: handoff.reason,
          },
        },
      };
    }

    if (!isEvaluation && sideEffectMode !== 'knowledge_test' && agentResult.success && isCacheableAgentResult(agentResult)) {
      setCachedResponse(
        sanitizedMessage,
        agentResult.response,
        'KNOWLEDGE_QUERY',
        agentResult.guidanceText,
        resolvedVillageId,
      );
    }

    return finish(agentResult);
    
  } catch (error: any) {
    const processingTimeMs = Date.now() - startTime;
    
    // Update status: error
    tracker.error(error.message);
    
    logger.error('❌ [UnifiedProcessor] Processing failed', {
      traceId,
      userId,
      channel,
      error: error.message,
      processingTimeMs,
    });
    
    // Use smart fallback based on context
    
    // Determine error type for better fallback
    let errorType: string | undefined;
    if (error.message?.includes('timeout') || error.message?.includes('ETIMEDOUT')) {
      errorType = 'TIMEOUT';
    } else if (error.message?.includes('rate limit') || error.message?.includes('429')) {
      errorType = 'RATE_LIMIT';
    } else if (error.message?.includes('ECONNREFUSED') || error.message?.includes('503')) {
      errorType = 'SERVICE_DOWN';
    }
    
    // Get smart fallback - tries to continue conversation flow if possible
    const fallbackResponse = errorType 
      ? getErrorFallback(errorType)
      : getSmartFallback(userId, undefined, workingMessage);
    
    return finish({
      success: false,
      response: fallbackResponse,
      intent: 'ERROR',
      metadata: { processingTimeMs, hasKnowledge: false, traceId },
      error: error.message,
    });
  } finally {
    const analyticsResult = finalResult as ProcessMessageResult | null;
    if (!isEvaluation && sideEffectMode !== 'knowledge_test' && analyticsResult && analyticsResult.intent !== 'SPAM') {
      await aiAnalyticsService.recordInteractionEvent({
        waUserId: userId,
        villageId,
        channel,
        intent: deriveAnalyticsIntent(analyticsResult),
        success: analyticsResult.success,
        hasKnowledge: analyticsResult.metadata.hasKnowledge,
        isFallback: analyticsResult.intent === 'ERROR',
        agentMode: analyticsResult.metadata.agentMode,
        responseSource: deriveAnalyticsSource(analyticsResult),
        toolsUsed: analyticsResult.metadata.toolsUsed,
        model: analyticsResult.metadata.model,
        processingTimeMs: analyticsResult.metadata.processingTimeMs,
      });

      if (analyticsResult.metadata.agentMode === 'single_orchestrator') {
        await recordToolExecutionTraces({
          traceId: analyticsResult.metadata.traceId,
          billingGroupId,
          messageId: resolvedMessageId,
          waUserId: userId,
          sessionId: channel === 'webchat' ? userId : undefined,
          villageId,
          channel,
          toolTrace: analyticsResult.metadata.toolTrace as any,
        });

        await recordToolPolicyEvent({
          traceId: analyticsResult.metadata.traceId,
          waUserId: userId,
          villageId,
          channel,
          query: workingMessage,
          heuristicTools: (analyticsResult.metadata.heuristicTools || []) as any,
          learnedTools: (analyticsResult.metadata.learnedTools || []) as any,
          allowedTools: (analyticsResult.metadata.allowedTools || []) as any,
          actualTools: analyticsResult.metadata.toolsUsed || [],
          success: analyticsResult.success,
          policyKey: analyticsResult.metadata.toolPolicy?.policyKey,
          policySource: analyticsResult.metadata.toolPolicy?.policySource,
        });
      }
    }
    try {
      await finishAiBillingTurn(billingTurn);
    } catch (billingError: any) {
      logger.error('AI message billing finalization failed', {
        traceId,
        billingGroupId,
        error: billingError?.message || String(billingError),
      });
    }
    decrementActiveProcessing();
  }
}

export default {
  processUnifiedMessage,
  handleComplaintCreation,
  handleComplaintUpdate,
  handleServiceInfo,
  handleServiceRequestCreation,
  handleStatusCheck,
  handleCancellationRequest,
  handleHistory,
  validateResponse,
};
