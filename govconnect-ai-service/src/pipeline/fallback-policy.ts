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
export function buildFallback(input: FallbackInput): { response: string; ticketRef: string } {
  const ticket = mintTempTicket();
  const intentLine = INTENT_LINE[input.intentHint ?? ''] ?? 'pesan Anda';

  const first =
    input.terminalState === 'BUDGET_EXHAUSTED'
      ? 'Mohon maaf, permintaan Anda membutuhkan waktu lebih lama dari biasanya dan belum selesai saya proses.'
      : 'Mohon maaf, sistem kami sedang mengalami gangguan sehingga saya belum bisa memproses ' + intentLine + ' saat ini.';

  const response = [
    first,
    `Nomor referensi sementara Anda: *${ticket}*. Simpan nomor ini — perangkat desa akan menindaklanjuti.`,
    'Anda juga bisa langsung menghubungi kantor desa pada jam operasional.',
  ].join('\n\n');

  return { response, ticketRef: ticket };
}

/**
 * Persist the fallback ticket so the temporary reference is REAL:
 * it lands in pipeline_fallback_tickets (status=open) and in the audit
 * trail. Fire-and-forget — never blocks the reply to the citizen.
 */
export function persistFallbackTicket(input: FallbackInput, ticketRef: string): void {
  const tenantId = input.tenantId ?? '';
  if (!tenantId) {
    logger.warn('[fallback] no tenantId — ticket persisted to audit only', { ticketRef });
  }
  void (async () => {
    try {
      if (tenantId) {
        await createFallbackTicket({
          ticketId: ticketRef,
          tenantId,
          userId: input.userId,
          channel: input.channel ?? 'whatsapp',
          stage: input.stage,
          reason: input.terminalState,
          detail: (input.error ?? '').slice(0, 500),
        });
      }
      await appendAudit({
        tenantId, traceId: input.traceId, userId: input.userId,
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
