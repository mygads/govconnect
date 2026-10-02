/**
 * Complaint FSM — typed finite state machine for pengaduan (complaint) creation.
 *
 * Why this file exists:
 *   Production audit found that when a user replied with the missing address
 *   ("didepan sman 1 margahayu jalan radio") while the complaint was waiting
 *   on `waitingFor: 'alamat'`, the pending state was not consumed deterministically.
 *   Control fell back to the general agent and the complaint never got created.
 *
 * The FSM centralizes:
 *   - canonical state shape (typed, not a loose blob)
 *   - explicit transitions: draft → waiting_for_address → waiting_for_identity →
 *     ready_to_submit → submitted / cancelled
 *   - deterministic resume when a follow-up message provides the missing field
 *   - interrupt detection (escape, topic switch) so the user isn't trapped
 *
 * Persistence is layered on top of the existing LRU + DB state-persistence
 * plumbing so we don't need a schema migration.
 */

import logger from '../utils/logger';
import { assertNotAborted } from '../pipeline/abort-guard';
import { rememberMemoryEvent } from './hybrid-memory.service';
import {
  setPendingAddressRequest,
  clearPendingAddressRequest,
  getPendingAddressRequestWithFallback,
  setPendingComplaintData,
  clearPendingComplaintData,
  getPendingComplaintDataWithFallback,
} from './ump-state';
import { getAutoFillSuggestionsWithFallback } from './user-profile.service';
import {
  extractAddressFromMessage,
  resolveComplaintTypeConfig,
} from './ump-utils';
import { analyzeAddress, extractNameViaNLU } from './micro-llm-matcher.service';
import type { ChannelType } from './ump-formatters';
import { isContactDirectoryLookup } from './important-contacts.service';

// ============================================================
// State shape
// ============================================================

export type ComplaintFsmState =
  | 'idle'
  | 'draft'
  | 'waiting_for_address'
  | 'waiting_for_name'
  | 'waiting_for_phone'
  | 'waiting_for_confirmation'
  | 'ready_to_submit'
  | 'submitted'
  | 'cancelled';

export interface ComplaintDraft {
  kategori?: string;
  deskripsi?: string;
  alamat?: string;
  rt_rw?: string;
  village_id?: string;
  channel?: ChannelType;
  foto_url?: string;
  reporter_name?: string;
  reporter_phone?: string;
}

export interface ComplaintFsmSnapshot {
  state: ComplaintFsmState;
  draft: ComplaintDraft;
  waitingFor?: 'alamat' | 'nama' | 'no_hp';
  reason?: string;
  /** What the FSM wants the caller to do next. */
  action:
    | 'noop'
    | 'persist_waiting_address'
    | 'persist_waiting_identity'
    | 'submit_complaint'
    | 'release_and_fallback';
}

// ============================================================
// Pure decision helpers
// ============================================================

export type FsmInterrupt =
  | 'explicit_cancel'
  | 'greeting'
  | 'status_lookup'
  | 'contact_directory_interrupt'
  | 'service_info_switch'
  | 'frustration'
  | 'handoff_request'
  | 'correction'
  | 'question'
  | 'none';

const EXPLICIT_ESCAPE_PATTERN = /\b(batal|cancel|lupakan|gausah|gak\s*jadi|nanti\s+(aja|dulu)|stop|berhenti)\b/i;
const GREETING_PATTERN = /^(halo|hai|hi|hello|assalamualaikum|permisi|p|selamat (pagi|siang|sore|malam))[\s!.,?]*$/i;
const STATUS_LOOKUP_PATTERN = /\b(lap|lay)-?\d{8}-?\d{3}\b/i;
const SERVICE_SWITCH_PATTERN = /\b(saya\s+mau|ingin|urus|urusin)\s+(ktp|kk|akta|domisili|sktm|surat)\b/i;
// E1/E2/E3/J2/J4: detect frustration, handoff requests, corrections, and
// questions while a complaint draft is active so the FSM does not hijack
// the turn by endlessly re-asking for the pending field.
const FRUSTRATION_PATTERN = /\b(muter[-\s]?muter|berputar[-\s]?putar|lama\s+banget|kelamaan|payah|bodoh|menyebalkan|kesal|kesel|frustrasi|tidak\s+membantu|nggak\s+membantu|gak\s+membantu|capek|bosan|nyebelin|gajelas|nggak\s+jelas|gak\s+jelas)\b/i;
const HANDOFF_PATTERN = /\b(petugas\s+asli|orang\s+asli|manusia|operator|cs\s+asli|bicara\s+dengan\s+(petugas|orang|manusia)|sambungkan|hubungkan\s+(ke|sama)|mau\s+(bicara|ngomong)\s+(sama|dengan|ke))\b/i;
const CORRECTION_PATTERN = /\b(eh\s+)?(salah|rubah|ubah|ganti|koreksi|revisi|maksud\s+(saya|aku|gue)|bukan\s+itu|bukan\s+di|bukan\s+[^,]+,\s*(?:tapi|melainkan))\b/i;
const QUESTION_PATTERN = /^(kapan|bagaimana|gimana|kenapa|mengapa|dimana|di\s+mana|berapa|apakah|bisakah|bisa\s+nggak|bisa\s+tidak).*\?|^.*\?\s*$/i;

export function detectComplaintInterrupt(message: string): FsmInterrupt {
  const trimmed = (message || '').trim();
  if (!trimmed) return 'none';

  if (EXPLICIT_ESCAPE_PATTERN.test(trimmed)) return 'explicit_cancel';
  if (GREETING_PATTERN.test(trimmed)) return 'greeting';
  if (STATUS_LOOKUP_PATTERN.test(trimmed)) return 'status_lookup';
  if (isContactDirectoryLookup(trimmed)) return 'contact_directory_interrupt';
  if (SERVICE_SWITCH_PATTERN.test(trimmed)) return 'service_info_switch';
  if (FRUSTRATION_PATTERN.test(trimmed)) return 'frustration';
  if (HANDOFF_PATTERN.test(trimmed)) return 'handoff_request';
  if (CORRECTION_PATTERN.test(trimmed)) return 'correction';
  if (QUESTION_PATTERN.test(trimmed)) return 'question';

  return 'none';
}

// ============================================================
// Orchestration entry points
// ============================================================

/**
 * Determine the next FSM action for a user message that arrived while the
 * complaint was waiting for an address.
 *
 * This is the function that previously lived inline in the pre-agent router
 * and that leaked control to the general agent in production. Keeping it
 * isolated lets us unit-test it deterministically.
 */
export async function decideAddressResume(input: {
  userId: string;
  message: string;
  pendingAddr: {
    kategori: string;
    deskripsi: string;
    village_id?: string;
    timestamp: number;
    foto_url?: string;
  };
  channel: ChannelType;
}): Promise<
  | { action: 'interrupt'; reason: FsmInterrupt }
  | { action: 'reprompt'; reason: 'too_short' }
  | { action: 'resume'; alamat: string; reason: 'nlu_extracted' | 'nlu_usable' }
  | { action: 'reprompt'; reason: 'not_address' }
> {
  const interrupt = detectComplaintInterrupt(input.message);
  if (interrupt !== 'none') {
    return { action: 'interrupt', reason: interrupt };
  }

  const trimmed = input.message.trim();
  if (trimmed.length < 5) {
    return { action: 'reprompt', reason: 'too_short' };
  }

  // Deterministic: pola RT/RW sederhana langsung diterima tanpa LLM
  // Contoh: "rt 05", "RT 05", "rt 05 rw 02", "rt05/rw02"
  const rtRwPattern = /\brt\s*\.?\s*\d{1,3}\s*(\/\s*rw\s*\.?\s*\d{1,3}|rw\s*\.?\s*\d{1,3})?\b/i;
  if (rtRwPattern.test(trimmed)) {
    return { action: 'resume', alamat: trimmed, reason: 'nlu_extracted' };
  }

  const extracted = await extractAddressFromMessage(trimmed, input.userId, {
    village_id: input.pendingAddr.village_id,
    channel: input.channel,
    kategori: input.pendingAddr.kategori,
  });

  if (extracted && extracted.length >= 5) {
    return { action: 'resume', alamat: extracted, reason: 'nlu_extracted' };
  }

  if (trimmed.length > 10) {
    const hasSpecificAddressPattern =
      /\brt\s*\.?\s*\d+\s*[\/\s]*rw\s*\.?\s*\d+/i.test(trimmed) ||
      /\b(?:jl|jln|jalan)\.?\s+.+(?:no|nomor|blok)\.?\s*\d+/i.test(trimmed);

    if (hasSpecificAddressPattern) {
      return { action: 'resume', alamat: trimmed, reason: 'nlu_usable' };
    }

    const addrAnalysis = await analyzeAddress(trimmed, {
      village_id: input.pendingAddr.village_id,
      is_complaint_context: true,
      kategori: input.pendingAddr.kategori,
    });

    if (addrAnalysis?.has_address && addrAnalysis.address && addrAnalysis.quality === 'specific') {
      return { action: 'resume', alamat: addrAnalysis.address, reason: 'nlu_usable' };
    }

    // [P0#2 FIX] Dalam konteks komplain, deskripsi lokasi landmark ("tps deket pasar",
    // "depan masjid", "dekat sekolah") valid walau tanpa RT/RW formal. Terima jika
    // mengandung kata lokasi umum.
    const hasLocationHint = /\b(tps|pasar|masjid|mushola|sekolah|kantor|balai|desa|dusun|gang|jalan|jl\.?|depan|belakang|samping|dekat|samping|sebelah|depan|pos|ronda|pertigaan|perempatan|jembatan|sungai|kali|lapangan)\b/i.test(trimmed);
    if (hasLocationHint && trimmed.length >= 10) {
      return { action: 'resume', alamat: trimmed, reason: 'nlu_usable' };
    }

    return { action: 'reprompt', reason: 'not_address' };
  }

  return { action: 'reprompt', reason: 'too_short' };
}

export interface DecideIdentityResumeInput {
  userId: string;
  message: string;
  waitingFor: 'nama' | 'no_hp' | 'konfirmasi';
  channel: ChannelType;
  villageId?: string;
}

export type DecideIdentityResumeOutput =
  | { action: 'interrupt'; reason: FsmInterrupt }
  | { action: 'reprompt'; reason: 'invalid_name' | 'invalid_phone' }
  | { action: 'confirm'; resolution: 'execute' | 'cancel' | 'edit' | 'reverify' }
  | { action: 'resume'; extractedName?: string; extractedPhone?: string };

/**
 * P0-4 (2026-10-02): Deterministic name extraction fallback.
 */
export function extractNameDeterministic(message: string): string | null {
  const trimmed = message.trim();
  if (!trimmed || trimmed.length > 50) return null;
  const explicitMatch = trimmed.match(
    /(?:nama\s+saya|namaku|saya\s+bernama|panggil\s+(?:saya|aku))\s+([A-Za-z][A-Za-z\s]{1,40})/i
  );
  if (explicitMatch) {
    const name = normalizeDeterministicName(explicitMatch[1]);
    if (name) return name;
  }
  const words = trimmed.split(/\s+/);
  if (words.length >= 2 && words.length <= 3) {
    const allCapitalized = words.every((w) => /^[A-Z][a-z]+$/.test(w));
    const hasNumber = /\d/.test(trimmed);
    const nonNameWords = /^(yang|dan|atau|dengan|untuk|dari|ke|di|saya|aku|kami|kita|ini|itu|adalah|jalan|gang|rt|rw|dusun|desa|nomor|no|telp|hp)$/i;
    const hasNonNameWord = words.some((w) => nonNameWords.test(w));
    if (allCapitalized && !hasNumber && !hasNonNameWord) {
      return normalizeDeterministicName(trimmed);
    }
  }
  return null;
}

function normalizeDeterministicName(name: string): string | null {
  const cleaned = name.trim().replace(/\s+/g, ' ');
  if (cleaned.length < 2) return null;
  const words = cleaned.split(' ').slice(0, 3);
  if (words.some((w) => w.length < 2 || !/^[A-Za-z]+$/.test(w))) return null;
  return words.map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()).join(' ');
}

export async function decideIdentityResume(input: DecideIdentityResumeInput): Promise<DecideIdentityResumeOutput> {
  // P1-1: VERIFY stage — check confirmation BEFORE interrupt detection,
  // so "batal"/"ubah" during verify are handled as confirm resolutions.
  // Explicit cancel during verify still releases via the interrupt path below
  // for safety, but confirm resolutions take precedence for UX clarity.
  if (input.waitingFor === 'konfirmasi') {
    const { isExplicitConfirmation, isCancellation, isCorrectionRequest } = await import('../pipeline/slot-fsm');
    const trimmed = input.message.trim();
    // Check explicit confirmation first (highest priority)
    if (isExplicitConfirmation(trimmed)) {
      return { action: 'confirm', resolution: 'execute' };
    }
    if (isCancellation(trimmed)) {
      return { action: 'confirm', resolution: 'cancel' };
    }
    if (isCorrectionRequest(trimmed)) {
      return { action: 'confirm', resolution: 'edit' };
    }
    // Fall through to interrupt detection for other patterns,
    // then to reverify if nothing matches
    const interruptDuringVerify = detectComplaintInterrupt(input.message);
    if (interruptDuringVerify !== 'none') {
      return { action: 'interrupt', reason: interruptDuringVerify };
    }
    return { action: 'confirm', resolution: 'reverify' };
  }

  const interrupt = detectComplaintInterrupt(input.message);
  if (interrupt !== 'none') {
    return { action: 'interrupt', reason: interrupt };
  }

  // E1: if waiting for name but the message looks like a location (not a
  // name), treat it as an implicit location correction — don't hijack.
  if (input.waitingFor === 'nama') {
    const looksLikeLocation = /\b(gang|jl\.?|jln|jalan|rt\s*\d|rw\s*\d|dusun|kampung|depan|belakang|samping|sebelah|dekat|patokan)\b/i.test(input.message);
    const looksLikeName = /^[A-Z][a-z]+(\s+[A-Z][a-z]+){0,3}$/.test(input.message.trim()) ||
      /\b(nama\s+(saya|aku)|namaku|saya\s+bernama|panggil\s+(saya|aku))\b/i.test(input.message);
    if (looksLikeLocation && !looksLikeName) {
      return { action: 'interrupt', reason: 'correction' };
    }
  }

  const trimmed = input.message.trim();

  if (input.waitingFor === 'nama') {
    try {
      const result = await extractNameViaNLU(trimmed, {
        village_id: input.villageId,
        wa_user_id: input.userId,
        session_id: input.userId,
        channel: input.channel,
      });
      if (result?.name && result.confidence >= 0.6) {
        return { action: 'resume', extractedName: result.name };
      }
    } catch {
      // fall through to deterministic fallback
    }
    const deterministicName = extractNameDeterministic(trimmed);
    if (deterministicName) {
      return { action: 'resume', extractedName: deterministicName };
    }
    return { action: 'reprompt', reason: 'invalid_name' };
  }

  // waitingFor === 'no_hp'
  const phoneMatch = trimmed.match(/\b(0[87]\d{8,11}|62[87]\d{8,11}|\+62[87]\d{8,11})\b/);
  if (phoneMatch) {
    return { action: 'resume', extractedPhone: phoneMatch[1].replace(/^\+/, '') };
  }
  return { action: 'reprompt', reason: 'invalid_phone' };
}

// ============================================================
// Persistence helpers
// ============================================================

export async function stashAddressDraft(input: {
  userId: string;
  kategori: string;
  deskripsi: string;
  villageId?: string;
  fotoUrl?: string;
}): Promise<void> {
  setPendingAddressRequest(input.userId, {
    kategori: input.kategori,
    deskripsi: input.deskripsi || `Laporan ${input.kategori.replace(/_/g, ' ')}`,
    village_id: input.villageId,
    timestamp: Date.now(),
    foto_url: input.fotoUrl,
  });
}

export async function releaseAddressDraft(userId: string): Promise<void> {
  clearPendingAddressRequest(userId);
}

export async function getComplaintSnapshot(userId: string): Promise<ComplaintFsmSnapshot> {
  const [addressPending, identityPending] = await Promise.all([
    getPendingAddressRequestWithFallback(userId),
    getPendingComplaintDataWithFallback(userId),
  ]);

  if (identityPending) {
    const state: ComplaintFsmState =
      identityPending.waitingFor === 'nama' ? 'waiting_for_name'
      : identityPending.waitingFor === 'no_hp' ? 'waiting_for_phone'
      : 'waiting_for_confirmation';
    return {
      state,
      waitingFor: identityPending.waitingFor === 'konfirmasi' ? undefined : identityPending.waitingFor,
      draft: {
        kategori: identityPending.kategori,
        deskripsi: identityPending.deskripsi,
        alamat: identityPending.alamat,
        rt_rw: identityPending.rt_rw,
        village_id: identityPending.village_id,
        channel: identityPending.channel,
        foto_url: identityPending.foto_url,
        reporter_name: identityPending.reporter_name,
        reporter_phone: identityPending.reporter_phone,
      },
      action: 'persist_waiting_identity',
      reason: 'pending_identity_state',
    };
  }

  if (addressPending) {
    return {
      state: 'waiting_for_address',
      waitingFor: 'alamat',
      draft: {
        kategori: addressPending.kategori,
        deskripsi: addressPending.deskripsi,
        village_id: addressPending.village_id,
        foto_url: addressPending.foto_url,
      },
      action: 'persist_waiting_address',
      reason: 'pending_address_state',
    };
  }

  return {
    state: 'idle',
    draft: {},
    action: 'noop',
  };
}

export async function submitComplaintDraft(input: {
  userId: string;
  draft: ComplaintDraft;
  channel: ChannelType;
}, opts?: { signal?: AbortSignal }): Promise<{ ok: boolean; reference?: string; reason?: string }> {
  const categoryConfig = input.draft.kategori
    ? await resolveComplaintTypeConfig(input.draft.kategori, input.draft.village_id)
    : null;

  if (!input.draft.kategori || !input.draft.alamat || !input.draft.deskripsi) {
    return { ok: false, reason: 'missing_fields' };
  }

  // P1-2: normalize kategori to the canonical category name from DB.
  const { resolveComplaintCategoryName } = await import('./ump-utils');
  const normalizedKategori = await resolveComplaintCategoryName(input.draft.kategori, input.draft.village_id)
    || categoryConfig?.name
    || input.draft.kategori;

  try {
    // P1-5: fail-closed — no write after the turn was aborted.
    assertNotAborted(opts?.signal, 'create_complaint');
    const { createComplaint } = await import('./case-client.service');
    const profile = await getAutoFillSuggestionsWithFallback(input.userId, input.draft.village_id); // W5: village-scoped

    const complaintId = await createComplaint({
      wa_user_id: input.channel === 'whatsapp' ? input.userId : undefined,
      channel: input.channel === 'whatsapp' ? 'WHATSAPP' : 'WEBCHAT',
      channel_identifier: input.channel === 'webchat' ? input.userId : undefined,
      kategori: normalizedKategori,
      deskripsi: input.draft.deskripsi,
      alamat: input.draft.alamat,
      rt_rw: input.draft.rt_rw,
      village_id: input.draft.village_id,
      is_urgent: categoryConfig?.is_urgent === true,
      require_address: categoryConfig?.require_address !== false,
      foto_url: input.draft.foto_url,
      reporter_name: input.draft.reporter_name || profile.nama_lengkap,
      reporter_phone: input.channel === 'whatsapp'
        ? input.userId
        : (input.draft.reporter_phone || profile.no_hp),
    });

    if (!complaintId) {
      return { ok: false, reason: 'create_failed' };
    }

    // Clear any pending state once we've successfully submitted.
    clearPendingAddressRequest(input.userId);
    clearPendingComplaintData(input.userId);

    void rememberMemoryEvent({
      wa_user_id: input.userId,
      village_id: input.draft.village_id,
      memory_type: 'complaint',
      memory_key: complaintId,
      importance: categoryConfig?.is_urgent === true ? 0.95 : 0.85,
      content: `Laporan ${complaintId} dibuat via FSM resume untuk kategori ${categoryConfig?.name || input.draft.kategori}${input.draft.alamat ? ` di ${input.draft.alamat}` : ''}.`,
      metadata_json: {
        reference_number: complaintId,
        kategori: normalizedKategori,
        alamat: input.draft.alamat,
        rt_rw: input.draft.rt_rw,
        is_urgent: categoryConfig?.is_urgent === true,
        source: 'complaint_fsm',
      },
    });

    return { ok: true, reference: complaintId };
  } catch (error: any) {
    logger.error('complaint-fsm submit failed', {
      userId: input.userId,
      error: error.message,
    });
    return { ok: false, reason: error.message };
  }
}

// ============================================================
// Identity resume helpers
// ============================================================

export async function stashIdentityDraft(input: {
  userId: string;
  draft: Required<Pick<ComplaintDraft, 'kategori' | 'deskripsi'>> & ComplaintDraft;
  waitingFor: 'nama' | 'no_hp';
  channel: ChannelType;
}): Promise<void> {
  setPendingComplaintData(input.userId, {
    kategori: input.draft.kategori,
    deskripsi: input.draft.deskripsi,
    alamat: input.draft.alamat,
    rt_rw: input.draft.rt_rw,
    village_id: input.draft.village_id,
    foto_url: input.draft.foto_url,
    channel: input.channel,
    timestamp: Date.now(),
    waitingFor: input.waitingFor,
  });
}

export async function releaseIdentityDraft(userId: string): Promise<void> {
  clearPendingComplaintData(userId);
}

export const __test_only__ = {
  detectComplaintInterrupt,
  buildConfirmationSummary,
};

/**
 * P1-1: Build the VERIFY-stage summary shown to the citizen before a
 * complaint is created. Per architecture \u00a74 (VERIFIKASI \u2192 EKSEKUSI), the
 * citizen must review and explicitly confirm the collected data.
 */
export function buildConfirmationSummary(input: {
  kategori: string;
  deskripsi?: string;
  alamat?: string;
  reporter_name?: string;
  reporter_phone?: string;
  kategoriLabel?: string;
}): string {
  const lines = [
    'Mohon periksa kembali laporan Anda:',
    '',
    `\uD83D\uDCCB Kategori: ${input.kategoriLabel || input.kategori}`,
    `\uD83D\uDCDD Deskripsi: ${input.deskripsi || '-'}`,
  ];
  if (input.alamat) lines.push(`\uD83D\uDCCD Lokasi: ${input.alamat}`);
  if (input.reporter_name) lines.push(`\uD83D\uDC64 Nama: ${input.reporter_name}`);
  if (input.reporter_phone) lines.push(`\uD83D\uDCDE Telepon: ${input.reporter_phone}`);
  lines.push('');
  lines.push('Apakah data sudah benar? Balas **YA** untuk mengirim laporan, atau sebutkan bagian yang perlu diubah.');
  return lines.join('\n');
}
