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

import {
  laporEnqueue, laporClaimPending, laporMarkResult, laporUpdateStatusByTrackingId,
  laporGetSentForStatusSync, appendAudit,
} from './pipeline-store';
import { registerInterval } from '../utils/timer-registry';
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

// ── W17: scheduler ────────────────────────────────────────────────────

/**
 * Interval drain outbox (ms). Default 5 menit. 0/non-angka → scheduler mati.
 * Hanya berjalan bila LAPOR_ENABLED=true (sender terkonfigurasi).
 */
export function getLaporDrainIntervalMs(): number {
  const raw = Number(process.env.LAPOR_DRAIN_INTERVAL_MS ?? '300000');
  return Number.isFinite(raw) && raw > 0 ? Math.floor(raw) : 0;
}

let drainSchedulerStarted = false;

/**
 * W17: pemanggil otomatis untuk drainLaporOutbox(). Sebelumnya fungsi ini
 * tidak punya pemanggil selain endpoint manual /internal/lapor/drain —
 * sisi kirim ≈ STUB. Scheduler in-process ini berjalan tiap
 * LAPOR_DRAIN_INTERVAL_MS dan memanggil drainLaporOutbox().
 * Idempotent & aman konkurensi via claim SKIP LOCKED di DB.
 */
export function startLaporDrainScheduler(): void {
  if (drainSchedulerStarted) return;
  const intervalMs = getLaporDrainIntervalMs();
  if (intervalMs <= 0) {
    logger.info('[lapor-bridge] drain scheduler disabled (LAPOR_DRAIN_INTERVAL_MS<=0)');
    return;
  }
  if (!LAPOR_ENABLED) {
    logger.info('[lapor-bridge] drain scheduler not started (LAPOR_ENABLED=false)');
    return;
  }
  drainSchedulerStarted = true;
  registerInterval(() => {
    drainLaporOutbox(25).then((r) => {
      if (r.sent > 0 || r.failed > 0) {
        logger.info('[lapor-bridge] scheduled drain', r);
      }
    }).catch((err) => {
      logger.warn('[lapor-bridge] scheduled drain failed', {
        error: String((err as Error)?.message ?? err).slice(0, 120),
      });
    });
  }, intervalMs, 'lapor-drain');
  logger.info('[lapor-bridge] drain scheduler started', { intervalMs });
}

/** Test hook: reset flag scheduler. */
export function __resetLaporDrainSchedulerForTest(): void {
  drainSchedulerStarted = false;
}

// ── W17: sync status balik ────────────────────────────────────────────

/**
 * Status update dari sisi LAPOR!.
 *
 * HONEST SCOPE: bentuk API resmi SP4N-LAPOR! bersifat deployment-specific
 * dan tidak diklaim ada. Interface ini mendukung dua jalur:
 * 1. Webhook push: operator/LAPOR! POST ke /internal/lapor/webhook.
 * 2. Operator-assisted: admin mengisi tracking_id + status manual via
 *    endpoint yang sama bila API LAPOR! tidak tersedia.
 * 3. Polling: pollLaporStatusUpdates() menanyakan status ke LAPOR_API_URL
 *    bila endpoint-nya dikonfigurasi.
 */
export interface LaporStatusUpdate {
  tracking_id: string;
  /** Status dari sisi LAPOR!, mis. 'diterima' | 'diproses' | 'selesai' | 'ditolak'. */
  status: string;
  note?: string;
  /** Sumber update: 'webhook' | 'poll' | 'manual'. */
  source: 'webhook' | 'poll' | 'manual';
}

const FINAL_LAPOR_STATUSES = new Set(
  ['selesai', 'ditolak', 'closed', 'rejected', 'done'],
);

/**
 * Terapkan satu status update: tulis ke outbox + audit trail.
 * Pure terhadap validasi; never-throw.
 */
export async function applyLaporStatusUpdate(
  update: LaporStatusUpdate,
): Promise<{ applied: boolean; outboxId: number | null }> {
  try {
    const trackingId = (update.tracking_id ?? '').trim();
    const status = (update.status ?? '').trim().toLowerCase();
    if (!trackingId || !status) {
      return { applied: false, outboxId: null };
    }
    const outboxId = await laporUpdateStatusByTrackingId(
      trackingId, status, update.note,
    );
    if (outboxId == null) {
      logger.warn('[lapor-bridge] status update for unknown tracking_id', {
        trackingId, source: update.source,
      });
      return { applied: false, outboxId: null };
    }
    await appendAudit({
      tenantId: '', traceId: trackingId, userId: '',
      channel: 'whatsapp', stage: 'EXECUTE', event: 'lapor_status_sync',
      payload: {
        outboxId, laporStatus: status, source: update.source,
        isFinal: FINAL_LAPOR_STATUSES.has(status),
      },
    }).catch(() => undefined);
    logger.info('[lapor-bridge] status synced', {
      outboxId, trackingId, status, source: update.source,
    });
    return { applied: true, outboxId };
  } catch (err) {
    logger.warn('[lapor-bridge] applyLaporStatusUpdate failed', {
      error: String((err as Error)?.message ?? err).slice(0, 120),
    });
    return { applied: false, outboxId: null };
  }
}

/**
 * Polling status balik: untuk baris 'sent' yang punya tracking_id dan belum
 * final, tanyakan status ke LAPOR_API_URL lalu terapkan via
 * applyLaporStatusUpdate(). Dijalankan manual via
 * POST /internal/lapor/poll-status atau dari scheduler bila diinginkan.
 *
 * Bila LAPOR_API_URL tidak terkonfigurasi → skip (operator-assisted via
 * webhook/manual tetap bisa dipakai).
 */
export async function pollLaporStatusUpdates(
  limit = 20,
): Promise<{ checked: number; updated: number; skipped: number }> {
  const result = { checked: 0, updated: 0, skipped: 0 };
  if (!senderConfigured()) {
    logger.info('[lapor-bridge] status poll skipped: sender not configured');
    result.skipped = 1;
    return result;
  }
  const rows = await laporGetSentForStatusSync(limit);
  for (const row of rows) {
    const trackingId = String(row.tracking_id ?? '');
    if (!trackingId) continue;
    result.checked += 1;
    try {
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), 15_000);
      // Bentuk endpoint dokumentasi best-effort; deployment-specific.
      const res = await fetch(
        `${LAPOR_API_URL}/laporan/${encodeURIComponent(trackingId)}/status`,
        {
          headers: { Authorization: `Bearer ${LAPOR_API_KEY}` },
          signal: ctrl.signal,
        },
      );
      clearTimeout(t);
      if (!res.ok) continue;
      const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
      const status =
        typeof json.status === 'string' ? json.status
        : typeof json.state === 'string' ? json.state
        : '';
      if (!status) continue;
      const applied = await applyLaporStatusUpdate({
        tracking_id: trackingId,
        status,
        note: typeof json.note === 'string' ? json.note : undefined,
        source: 'poll',
      });
      if (applied.applied) result.updated += 1;
    } catch (err) {
      logger.debug('[lapor-bridge] status poll item failed', {
        trackingId, error: String((err as Error)?.message ?? err).slice(0, 100),
      });
    }
  }
  return result;
}
