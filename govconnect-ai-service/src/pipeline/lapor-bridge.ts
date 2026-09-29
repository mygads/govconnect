/**
 * SP4N-LAPOR! bridge — forward eligible complaints with tracking.
 *
 * Design (arsitektur-final §5.8, v5 positioning):
 * - GovConnect is a compliant WhatsApp channel that FORWARDS eligible
 *   complaints to SP4N-LAPOR! and tracks them by tracking ID + status sync.
 * - Outbox pattern: complaints are mapped and enqueued into
 *   pipeline_lapor_outbox; a sender drains it. The actual HTTP sender is
 *   behind LAPOR_ENABLED (default false). While disabled, rows accumulate
 *   with status 'pending_config' — nothing is silently dropped, nothing is
 *   claimed as integrated.
 * - Privacy: NIK is NEVER included in the LAPOR payload. Only the
 *   citizen's WhatsApp number (as contact for follow-up) and the report.
 *
 * HONEST SCOPE: the exact SP4N-LAPOR! institutional endpoint shape is
 * deployment-specific. The payload below is a documented best-effort
 * mapping; production integration requires LAPOR_API_URL/KEY for the
 * target deployment and verification against its API docs. This module
 * does NOT claim a working production integration.
 */

import { laporEnqueue, laporClaimPending, laporMarkResult, appendAudit } from './pipeline-store';
import logger from '../utils/logger';

export const LAPOR_ENABLED = process.env.LAPOR_ENABLED === 'true';
const LAPOR_API_URL = (process.env.LAPOR_API_URL ?? '').replace(/\/$/, '');
const LAPOR_API_KEY = process.env.LAPOR_API_KEY ?? '';

export interface ComplaintForLapor {
  villageId: string;
  villageName?: string;
  complaintRef: string;
  category?: string;
  description: string;
  location?: string;
  reporterContact?: string; // WA number, for follow-up only
  hasImage?: boolean;
}

/**
 * Map a GovConnect complaint to the SP4N-LAPOR! report shape.
 * Pure function — safe to unit test.
 */
export function mapComplaintToLapor(c: ComplaintForLapor): Record<string, unknown> {
  const desc = (c.description ?? '').trim().slice(0, 2000);
  return {
    kanal: 'whatsapp_govconnect',
    judul: `[${c.category || 'Laporan warga'}] ${desc.slice(0, 80)}`,
    isi_laporan: desc,
    kategori: c.category || null,
    lokasi: [c.location, c.villageName].filter(Boolean).join(', ') || null,
    // Privacy: contact number only; NIK is NEVER forwarded.
    pelapor: { kontak: c.reporterContact ?? null },
    referensi_desa: c.complaintRef,
    lampiran_gambar: Boolean(c.hasImage),
    dikirim_pada: new Date().toISOString(),
  };
}

export function laporStatusForEnqueue(): 'pending' | 'pending_config' {
  return LAPOR_ENABLED ? 'pending' : 'pending_config';
}

/** Enqueue a filed complaint for LAPOR! forwarding (never throws). */
export async function enqueueComplaintToLapor(
  c: ComplaintForLapor,
): Promise<number | null> {
  try {
    const id = await laporEnqueue(
      c.villageId, c.complaintRef, mapComplaintToLapor(c), laporStatusForEnqueue(),
    );
    await appendAudit({
      tenantId: c.villageId, traceId: c.complaintRef, userId: c.reporterContact ?? '',
      channel: 'whatsapp', stage: 'EXECUTE', event: 'lapor_enqueued',
      payload: { outboxId: id, status: laporStatusForEnqueue() },
    }).catch(() => undefined);
    return id;
  } catch (err) {
    logger.warn('[lapor-bridge] enqueue failed', {
      error: String((err as Error)?.message ?? err).slice(0, 120),
    });
    return null;
  }
}

function senderConfigured(): boolean {
  return LAPOR_ENABLED && LAPOR_API_URL.length > 0 && LAPOR_API_KEY.length > 0;
}

/**
 * Drain the outbox: claim pending rows (SKIP LOCKED, so multiple senders are
 * safe) and POST each to the configured LAPOR endpoint. Intended to be run
 * from a cron/worker, NOT inline in the chat path.
 */
export async function drainLaporOutbox(
  limit = 10,
): Promise<{ sent: number; failed: number; skipped: number }> {
  const result = { sent: 0, failed: 0, skipped: 0 };
  if (!senderConfigured()) {
    // Rows with status pending_config wait for configuration; 'pending' rows
    // from a previous enabled period are left alone (no silent sends).
    logger.info('[lapor-bridge] sender not configured, skipping drain');
    result.skipped = 1;
    return result;
  }
  const rows = await laporClaimPending(limit);
  for (const row of rows) {
    const id = Number(row.id);
    try {
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), 30_000);
      const res = await fetch(`${LAPOR_API_URL}/laporan`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${LAPOR_API_KEY}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(row.payload),
        signal: ctrl.signal,
      });
      clearTimeout(t);
      if (!res.ok) {
        await laporMarkResult(id, false, undefined, `http ${res.status}`);
        result.failed += 1;
        continue;
      }
      const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
      const trackingId =
        typeof json.tracking_id === 'string' ? json.tracking_id
        : typeof json.id === 'string' ? json.id
        : undefined;
      await laporMarkResult(id, true, trackingId);
      result.sent += 1;
    } catch (err) {
      await laporMarkResult(
        id, false, undefined, String((err as Error)?.message ?? err).slice(0, 200),
      );
      result.failed += 1;
    }
  }
  return result;
}
