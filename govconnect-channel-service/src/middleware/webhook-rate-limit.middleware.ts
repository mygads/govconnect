/**
 * W8 — Rate limit untuk channel webhook (WhatsApp).
 *
 * Melindungi webhook dari banjir pesan (spam/flood):
 * - Sliding window per pengirim (sender JID/phone) + instance.
 * - Batas: 30 pesan/menit, 300 pesan/hari per pengirim (configurable via env).
 * - Melebihi batas → HTTP 429 dengan pesan jelas (never-silent).
 *
 * BATAS OPERASIONAL (didokumentasikan, bukan diimplementasikan):
 * Counter bersifat in-memory per process — tidak fleet-safe. Untuk deployment
 * multi-instance, ganti dengan Redis (mis. rate limit terdistribusi via
 * Redlock/sliding-window Lua script). Lihat OPERATIONAL-LIMITS.md.
 *
 * Env:
 * - WEBHOOK_RL_WINDOW_MS (default 60000)
 * - WEBHOOK_RL_MAX_PER_WINDOW (default 30)
 * - WEBHOOK_RL_MAX_PER_DAY (default 300)
 */

import type { Request, Response, NextFunction } from 'express';
import logger from '../utils/logger';

const WINDOW_MS = Number(process.env.WEBHOOK_RL_WINDOW_MS ?? 60_000);
const MAX_PER_WINDOW = Number(process.env.WEBHOOK_RL_MAX_PER_WINDOW ?? 30);
const MAX_PER_DAY = Number(process.env.WEBHOOK_RL_MAX_PER_DAY ?? 300);

interface WindowState {
  times: number[];
  day: string;
  dayCount: number;
}

// In-memory per process — lihat batas operasional di header file.
const windows = new Map<string, WindowState>();

/** Bersihkan entry lama secara oportunistik agar memori terbatas. */
function cleanup(now: number): void {
  if (windows.size < 10000) return;
  for (const [key, w] of windows) {
    w.times = w.times.filter((t) => now - t < WINDOW_MS);
    if (w.times.length === 0) windows.delete(key);
  }
}

/**
 * Ekstrak identitas pengirim dari body webhook genfity-wa.
 * Format: event.Info.Sender (JID) atau event.Info.SenderAlt.
 */
function extractSenderKey(body: any): string | null {
  try {
    const event = body?.event ?? body?.data?.event;
    const info = event?.Info;
    if (!info) return null;
    const sender =
      typeof info.Sender === 'string'
        ? info.Sender
        : typeof info.SenderAlt === 'string'
          ? info.SenderAlt
          : info.Sender?.User ?? null;
    if (!sender) return null;
    // Normalisasi: ambil bagian user dari JID (sebelum @).
    const user = String(sender).split('@')[0].replace(/\D/g, '');
    return user || null;
  } catch {
    return null;
  }
}

/** Ekstrak nama instance (untuk scoping per desa/nomor WA). */
function extractInstanceKey(body: any): string {
  const candidates = [
    body?.instanceName, body?.instance, body?.sessionName,
    body?.data?.instanceName, body?.event?.InstanceName,
  ];
  for (const c of candidates) {
    if (typeof c === 'string' && c.trim()) return c.trim();
  }
  return 'default';
}

export interface WebhookRateLimitResult {
  allowed: boolean;
  reason?: 'per_minute' | 'per_day';
  retryAfterMs?: number;
}

/** Pure function — bisa di-unit-test tanpa Express. */
export function checkWebhookRateLimit(
  senderKey: string, instanceKey: string, now = Date.now(),
): WebhookRateLimitResult {
  const key = `${instanceKey}:${senderKey}`;
  const day = new Date(now).toISOString().slice(0, 10);
  let w = windows.get(key);
  if (!w || w.day !== day) w = { times: [], day, dayCount: 0 };

  w.times = w.times.filter((t) => now - t < WINDOW_MS);

  if (w.times.length >= MAX_PER_WINDOW) {
    const oldest = Math.min(...w.times);
    windows.set(key, w);
    return {
      allowed: false,
      reason: 'per_minute',
      retryAfterMs: Math.max(0, WINDOW_MS - (now - oldest)),
    };
  }
  if (w.dayCount >= MAX_PER_DAY) {
    windows.set(key, w);
    return { allowed: false, reason: 'per_day' };
  }

  w.times.push(now);
  w.dayCount += 1;
  windows.set(key, w);
  cleanup(now);
  return { allowed: true };
}

/** Express middleware — dipasang sebelum handleWebhook. */
export function webhookRateLimit(req: Request, res: Response, next: NextFunction): void {
  try {
    // Hanya batasi event Message (pesan masuk); event lain (status, dsb.) bebas.
    const type = req.body?.type ?? req.body?.data?.type;
    if (type && type !== 'Message') {
      next();
      return;
    }

    const sender = extractSenderKey(req.body);
    if (!sender) {
      // Tidak bisa identifikasi pengirim — fail-open (jangan blokir desa).
      next();
      return;
    }

    const instance = extractInstanceKey(req.body);
    const verdict = checkWebhookRateLimit(sender, instance);

    if (!verdict.allowed) {
      logger.warn('[webhook-rate-limit] blocked', {
        sender: sender.slice(0, 6) + '***',
        instance,
        reason: verdict.reason,
      });
      res.status(429).json({
        status: 'rate_limited',
        message:
          verdict.reason === 'per_day'
            ? 'Terlalu banyak pesan hari ini. Coba lagi besok.'
            : 'Terlalu banyak pesan. Mohon tunggu sebentar sebelum mengirim lagi.',
        retryAfterMs: verdict.retryAfterMs ?? 60000,
      });
      return;
    }

    next();
  } catch (err) {
    // Fail-open: guard yang rusak tidak boleh mematikan webhook desa.
    logger.warn('[webhook-rate-limit] error (fail-open)', { error: String(err).slice(0, 200) });
    next();
  }
}

/** Test hook: reset state in-memory. */
export function __resetWebhookRateLimit(): void {
  windows.clear();
}
