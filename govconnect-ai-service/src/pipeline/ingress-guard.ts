/**
 * Ingress guard — rate limits + anomaly quarantine.
 *
 * Design (arsitektur-final §8, v5 threat model):
 * - Rate limit: per user+tenant sliding window. In-memory per process
 *   (same posture as the legacy rate-limiter); violations are persisted
 *   to the audit trail so a fleet still sees the full picture.
 * - Anomaly quarantine: deterministic signals only — oversize payloads,
 *   replay storms, and prompt-injection markers. Quarantined messages are
 *   NEVER processed by the agent; they land in pipeline_ingress_quarantine
 *   and get a neutral, never-silent reply.
 * - Fail-open on infra errors: a broken guard must not take the village
 *   offline; it logs and lets the message through to the bounded pipeline.
 */

import { quarantineAdd, appendAudit } from './pipeline-store';
import logger from '../utils/logger';

// ── Rate limiting (sliding window, per tenant+user) ─────────────────────────

const WINDOW_MS = Number(process.env.INGRESS_WINDOW_MS ?? 60_000);
const MAX_PER_WINDOW = Number(process.env.INGRESS_MAX_PER_WINDOW ?? 20);
const MAX_PER_DAY = Number(process.env.INGRESS_MAX_PER_DAY ?? 200);

interface WindowState { times: number[]; day: string; dayCount: number }
const windows = new Map<string, WindowState>();

export interface RateLimitVerdict { allowed: boolean; reason?: string }

export function checkRateLimit(tenantId: string, userId: string): RateLimitVerdict {
  try {
    const key = `${tenantId}:${userId}`;
    const now = Date.now();
    const day = new Date().toISOString().slice(0, 10);
    let w = windows.get(key);
    if (!w || w.day !== day) w = { times: [], day, dayCount: 0 };
    w.times = w.times.filter((t) => now - t < WINDOW_MS);
    if (w.times.length >= MAX_PER_WINDOW) {
      windows.set(key, w);
      return { allowed: false, reason: 'rate_limit_per_minute' };
    }
    if (w.dayCount >= MAX_PER_DAY) {
      windows.set(key, w);
      return { allowed: false, reason: 'rate_limit_per_day' };
    }
    w.times.push(now);
    w.dayCount += 1;
    windows.set(key, w);
    // Opportunistic cleanup to bound memory.
    if (windows.size > 50_000) {
      const oldest = [...windows.entries()].sort(
        (a, b) => (a[1].times[0] ?? 0) - (b[1].times[0] ?? 0),
      ).slice(0, 10_000);
      for (const [k] of oldest) windows.delete(k);
    }
    return { allowed: true };
  } catch {
    return { allowed: true }; // fail-open
  }
}

// ── Anomaly detection (deterministic signals) ──────────────────────────────

const INJECTION_PATTERNS: RegExp[] = [
  /ignore\s+(all\s+)?(previous|prior|above)\s+(instructions|prompts|rules)/i,
  /reveal\s+(your\s+)?(system|internal)\s+(prompt|instructions)/i,
  /tampilkan\s+(system\s+)?prompt/i,
  /jailbreak/i,
  /\bDAN\s+mode\b/i,
  /lupakan\s+(semua\s+)?(instruksi|aturan)/i,
  /abaikan\s+(semua\s+)?(instruksi|aturan|prompt)/i,
];

const MAX_MESSAGE_CHARS = 4000;
const REPLAY_WINDOW = 5;

const recentByUser = new Map<string, string[]>();

export interface AnomalyVerdict {
  anomalous: boolean;
  reason?: string;
  severity: 'low' | 'high';
}

/** Pure anomaly check — no I/O, safe to unit test. */
export function detectAnomaly(
  message: string, tenantId: string, userId: string,
): AnomalyVerdict {
  const text = message ?? '';
  if (text.length > MAX_MESSAGE_CHARS) {
    return { anomalous: true, reason: 'oversize_payload', severity: 'low' };
  }
  for (const p of INJECTION_PATTERNS) {
    if (p.test(text)) {
      return { anomalous: true, reason: 'prompt_injection_marker', severity: 'high' };
    }
  }
  // Replay storm: same exact message N times in a row.
  const key = `${tenantId}:${userId}`;
  const hist = recentByUser.get(key) ?? [];
  hist.push(text);
  if (hist.length > REPLAY_WINDOW) hist.shift();
  recentByUser.set(key, hist);
  if (hist.length === REPLAY_WINDOW && hist.every((m) => m === text) && text.length > 0) {
    return { anomalous: true, reason: 'replay_storm', severity: 'low' };
  }
  return { anomalous: false, severity: 'low' };
}

// ── Combined ingress check ────────────────────────────────────────────────

export interface IngressVerdict {
  action: 'allow' | 'rate_limited' | 'quarantined';
  reason?: string;
  /** Neutral user-facing reply when not allowed (never-silent). */
  userReply?: string;
}

const RATE_LIMIT_COPY =
  'Bentar ya, pesannya terlalu cepat beruntun. Tunggu sekitar satu menit lalu kirim lagi.';

const QUARANTINE_COPY =
  'Pesan Bapak/Ibu sudah kami terima dan petugas desa akan menindaklanjuti. Mohon tidak mengirim pesan yang sama berulang kali.';

export async function ingressCheck(input: {
  tenantId: string; userId: string; channel: string; traceId: string; message: string;
}): Promise<IngressVerdict> {
  const { tenantId, userId, channel, traceId, message } = input;

  const rl = checkRateLimit(tenantId, userId);
  if (!rl.allowed) {
    await appendAudit({
      tenantId, traceId, userId, channel, stage: 'INGRESS', event: 'rate_limited',
      payload: { reason: rl.reason },
    }).catch(() => undefined);
    logger.info('[ingress-guard] rate limited', { tenantId, reason: rl.reason });
    return { action: 'rate_limited', reason: rl.reason, userReply: RATE_LIMIT_COPY };
  }

  const anomaly = detectAnomaly(message, tenantId, userId);
  if (anomaly.anomalous) {
    await quarantineAdd({
      tenantId, userId, channel, reason: anomaly.reason ?? 'anomaly',
      excerpt: `len=${message.length} sev=${anomaly.severity}: ${message.slice(0, 200)}`,
    }).catch(() => undefined);
    await appendAudit({
      tenantId, traceId, userId, channel, stage: 'INGRESS', event: 'message_quarantined',
      payload: { reason: anomaly.reason, severity: anomaly.severity },
    }).catch(() => undefined);
    logger.warn('[ingress-guard] message quarantined', {
      tenantId, reason: anomaly.reason, severity: anomaly.severity,
    });
    return { action: 'quarantined', reason: anomaly.reason, userReply: QUARANTINE_COPY };
  }

  return { action: 'allow' };
}
