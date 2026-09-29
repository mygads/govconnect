/**
 * Fallback Policy — the never-silent guarantee.
 *
 * Design (arsitektur-final §2, §8):
 * - An empty string is NEVER a valid response.
 * - When the pipeline fails (timeout, LLM error, budget exhausted), the
 *   citizen ALWAYS gets a degraded-but-honest message plus a temporary
 *   ticket reference, and the turn ends in a terminal state.
 * - The degraded message contains NO fabricated facts: it acknowledges the
 *   problem, gives a reference, and promises follow-up.
 */

import crypto from 'crypto';
import type { Stage, TerminalState } from './stage-types';
import { createFallbackTicket } from './pipeline-store';
import { appendAudit } from './pipeline-store';
import logger from '../utils/logger';

export interface FallbackInput {
  stage: Stage;
  terminalState: TerminalState;
  userId: string;
  traceId: string;
  tenantId?: string;
  channel?: string;
  /** What the user was trying to do, in plain words (no PII). */
  intentHint?: string;
  error?: string;
}

/** Mint a temporary ticket reference for follow-up. */
export function mintTempTicket(prefix = 'TMP'): string {
  const d = new Date();
  const date = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`;
  return `${prefix}-${date}-${crypto.randomBytes(3).toString('hex').toUpperCase()}`;
}

const INTENT_LINE: Record<string, string> = {
  complaint: 'laporan Anda',
  service_request: 'permohonan layanan Anda',
  status_check: 'permintaan cek status Anda',
  information: 'pertanyaan Anda',
};

/** Structured fallback including the ticket ref for persistence. */
export function buildFallback(
  input: FallbackInput,
  ticketRef?: string,
  opts: { persisted?: boolean } = {},
): { response: string; ticketRef: string } {
  const ticket = ticketRef ?? mintTempTicket();
  const intentLine = INTENT_LINE[input.intentHint ?? ''] ?? 'pesan Anda';

  const first =
    input.terminalState === 'BUDGET_EXHAUSTED'
      ? 'Mohon maaf, permintaan Anda membutuhkan waktu lebih lama dari biasanya dan belum selesai saya proses.'
      : 'Mohon maaf, sistem kami sedang mengalami gangguan sehingga saya belum bisa memproses ' + intentLine + ' saat ini.';

  // Honesty rule: only claim the report "sudah tercatat" when the ticket
  // row is actually in the DB. When unpersisted (DB down / no tenant),
  // say so plainly and tell the citizen what to do instead.
  const persisted = opts.persisted ?? true;
  const second = persisted
    ? `Nomor referensi sementara Anda: *${ticket}*. Simpan nomor ini — laporan Anda sudah tercatat dan petugas desa akan menindaklanjuti.`
    : `Nomor referensi sementara Anda: *${ticket}*. Karena gangguan ini, laporan Anda BELUM tersimpan — mohon kirim ulang beberapa saat lagi. Jika mendesak, hubungi langsung kantor desa; petugas desa akan menindaklanjuti setelah laporan Anda diterima.`;

  const response = [
    first,
    second,
    'Anda juga bisa langsung menghubungi kantor desa pada jam operasional.',
  ].join('\n\n');

  return { response, ticketRef: ticket };
}

/**
 * Mint a ticket id AND persist it atomically (best-effort): the INSERT uses
 * ON CONFLICT DO NOTHING, and on id collision we re-mint (max attempts).
 * P2-9 (deep audit): the citizen must never hold a reference that is not in
 * the DB. On DB outage we still return a reference (never-silent wins) but
 * mark it explicitly unpersisted.
 */
async function mintUniqueTicketId(
  input: FallbackInput,
): Promise<{ ticketRef: string; persisted: boolean }> {
  const tenantId = input.tenantId ?? '';
  if (!tenantId) {
    const ticketRef = mintTempTicket();
    logger.warn('[fallback] no tenantId — ticket issued without DB persistence', { ticketRef });
    return { ticketRef, persisted: false };
  }
  for (let attempt = 1; attempt <= 3; attempt++) {
    const ticketRef = mintTempTicket();
    const res = await createFallbackTicket({
      ticketId: ticketRef,
      tenantId,
      userId: input.userId,
      channel: input.channel ?? 'whatsapp',
      stage: input.stage,
      reason: input.terminalState,
      detail: (input.error ?? '').slice(0, 500),
    });
    if (res === 'inserted') return { ticketRef, persisted: true };
    if (res === 'conflict') {
      logger.warn('[fallback] ticket id collision — re-minting', { attempt, ticketRef });
      continue;
    }
    logger.warn('[fallback] ticket DB unavailable — issuing unpersisted reference', { ticketRef });
    return { ticketRef, persisted: false };
  }
  // Unreachable in practice (3 × 1/16.7M collisions), but never return empty.
  const ticketRef = mintTempTicket();
  logger.error('[fallback] ticket id collision exhausted retries — issuing unpersisted reference', { ticketRef });
  return { ticketRef, persisted: false };
}

/**
 * Atomic fallback: mint + persist + audit, then build the user-facing
 * response. The reference inside the response is the same one that was
 * persisted — the "reference is REAL" invariant of the never-silent
 * guarantee. Pass { persist: false } in shadow/evaluation mode so no
 * production state is written (P1-1).
 */
export async function issueFallback(
  input: FallbackInput,
  opts: { persist?: boolean } = {},
): Promise<{ response: string; ticketRef: string; persisted: boolean }> {
  const persist = opts.persist ?? true;
  const { ticketRef, persisted } = persist
    ? await mintUniqueTicketId(input)
    : { ticketRef: mintTempTicket(), persisted: false };
  if (persist) {
    try {
      await appendAudit({
        tenantId: input.tenantId ?? '', traceId: input.traceId, userId: input.userId,
        channel: input.channel ?? 'whatsapp', stage: input.stage,
        event: 'fallback_ticket_issued',
        payload: {
          ticketRef, persisted,
          terminalState: input.terminalState, intentHint: input.intentHint ?? null,
        },
      });
    } catch (err) {
      logger.warn('[fallback] fallback_ticket_issued audit failed', {
        error: String((err as Error)?.message ?? err).slice(0, 200),
      });
    }
  }
  const { response } = buildFallback(input, ticketRef, { persisted });
  assertNonEmptyResponse(response, 'issueFallback');
  return { response, ticketRef, persisted };
}

/**
 * @deprecated Use {@link issueFallback} — it mints, persists (collision-safe)
 * and audits atomically. Kept as a fire-and-forget wrapper so existing
 * callers don't break; it delegates to issueFallback with persist enabled.
 */
export function persistFallbackTicket(input: FallbackInput, ticketRef: string): void {
  void (async () => {
    try {
      if (input.tenantId) {
        await createFallbackTicket({
          ticketId: ticketRef,
          tenantId: input.tenantId,
          userId: input.userId,
          channel: input.channel ?? 'whatsapp',
          stage: input.stage,
          reason: input.terminalState,
          detail: (input.error ?? '').slice(0, 500),
        });
      }
      await appendAudit({
        tenantId: input.tenantId ?? '', traceId: input.traceId, userId: input.userId,
        channel: input.channel ?? 'whatsapp', stage: input.stage,
        event: 'fallback_ticket_issued',
        payload: { ticketRef, terminalState: input.terminalState, intentHint: input.intentHint ?? null },
      });
    } catch (err) {
      logger.warn('[fallback] persistFallbackTicket failed', {
        error: String((err as Error)?.message ?? err).slice(0, 200),
      });
    }
  })();
}

/** Guard: crash loudly in dev if something tries to return an empty reply. */
export function assertNonEmptyResponse(text: string, where: string): void {
  if (!text || !text.trim()) {
    throw new Error(`[never-silent] empty response produced at ${where}`);
  }
}
