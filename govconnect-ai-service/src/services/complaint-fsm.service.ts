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
  | 'none';

const EXPLICIT_ESCAPE_PATTERN = /\b(batal|cancel|lupakan|gausah|gak\s*jadi|nanti\s+(aja|dulu)|stop|berhenti)\b/i;
const GREETING_PATTERN = /^(halo|hai|hi|hello|assalamualaikum|permisi|p|selamat (pagi|siang|sore|malam))[\s!.,?]*$/i;
const STATUS_LOOKUP_PATTERN = /\b(lap|lay)-?\d{8}-?\d{3}\b/i;
const SERVICE_SWITCH_PATTERN = /\b(saya\s+mau|ingin|urus|urusin)\s+(ktp|kk|akta|domisili|sktm|surat)\b/i;

export function detectComplaintInterrupt(message: string): FsmInterrupt {
  const trimmed = (message || '').trim();
  if (!trimmed) return 'none';

  if (EXPLICIT_ESCAPE_PATTERN.test(trimmed)) return 'explicit_cancel';
  if (GREETING_PATTERN.test(trimmed)) return 'greeting';
  if (STATUS_LOOKUP_PATTERN.test(trimmed)) return 'status_lookup';
  if (isContactDirectoryLookup(trimmed)) return 'contact_directory_interrupt';
  if (SERVICE_SWITCH_PATTERN.test(trimmed)) return 'service_info_switch';

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

    return { action: 'reprompt', reason: 'not_address' };
  }

  return { action: 'reprompt', reason: 'too_short' };
}

export interface DecideIdentityResumeInput {
  userId: string;
  message: string;
  waitingFor: 'nama' | 'no_hp';
  channel: ChannelType;
  villageId?: string;
}

export type DecideIdentityResumeOutput =
  | { action: 'interrupt'; reason: FsmInterrupt }
  | { action: 'reprompt'; reason: 'invalid_name' | 'invalid_phone' }
  | { action: 'resume'; extractedName?: string; extractedPhone?: string };

export async function decideIdentityResume(input: DecideIdentityResumeInput): Promise<DecideIdentityResumeOutput> {
  const interrupt = detectComplaintInterrupt(input.message);
  if (interrupt !== 'none') {
    return { action: 'interrupt', reason: interrupt };
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
      // fall through
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
    return {
      state: identityPending.waitingFor === 'nama' ? 'waiting_for_name' : 'waiting_for_phone',
      waitingFor: identityPending.waitingFor,
      draft: {
        kategori: identityPending.kategori,
        deskripsi: identityPending.deskripsi,
        alamat: identityPending.alamat,
        rt_rw: identityPending.rt_rw,
        village_id: identityPending.village_id,
        channel: identityPending.channel,
        foto_url: identityPending.foto_url,
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
}): Promise<{ ok: boolean; reference?: string; reason?: string }> {
  const categoryConfig = input.draft.kategori
    ? await resolveComplaintTypeConfig(input.draft.kategori, input.draft.village_id)
    : null;

  if (!input.draft.kategori || !input.draft.alamat || !input.draft.deskripsi) {
    return { ok: false, reason: 'missing_fields' };
  }

  try {
    const { createComplaint } = await import('./case-client.service');
    const profile = await getAutoFillSuggestionsWithFallback(input.userId);

    const complaintId = await createComplaint({
      wa_user_id: input.channel === 'whatsapp' ? input.userId : undefined,
      channel: input.channel === 'whatsapp' ? 'WHATSAPP' : 'WEBCHAT',
      channel_identifier: input.channel === 'webchat' ? input.userId : undefined,
      kategori: categoryConfig?.name || input.draft.kategori,
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
        kategori: categoryConfig?.name || input.draft.kategori,
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
};
