/**
 * A1 — Handoff summary: when the AI hands a conversation to a human
 * (takeover), build a compact summary so village staff understand the
 * context without reading the whole chat.
 *
 * Sources: current turn state (stage + slots) and recent audit-trail
 * events. The builder is PURE (unit-testable); persistence is best-effort.
 */

import { createHash, randomUUID } from 'crypto';
import { getDb, dbDown, appendAudit } from './pipeline-store';
import logger from '../utils/logger';

export interface HandoffSummaryInput {
  stage: string;
  slots: Record<string, unknown>;
  identityLevel?: string;
  lastCitizenMessage?: string;
  recentEvents: Array<{
    stage: string;
    event: string;
    occurredAt: string;
    payload?: Record<string, unknown>;
  }>;
  takenBy: string;
  reason: string;
}

export interface HandoffSummary {
  intent?: string;
  stage: string;
  identityLevel?: string;
  filledSlots: Array<{ key: string; value: string }>;
  pendingMutation: boolean;
  lastCitizenMessage?: string;
  timeline: string[];
  /** Bahasa Indonesia, staff-friendly. */
  text: string;
}

const INTERNAL_SLOT_PREFIX = '_';
const MAX_TIMELINE = 8;
const MAX_VALUE_LEN = 120;

function short(v: unknown): string {
  const s = typeof v === 'string' ? v : JSON.stringify(v) ?? '';
  return s.length > MAX_VALUE_LEN ? s.slice(0, MAX_VALUE_LEN) + '…' : s;
}

function eventLine(e: HandoffSummaryInput['recentEvents'][number]): string | null {
  const p = e.payload ?? {};
  switch (e.event) {
    case 'turn_completed':
      return `AI menjawab (${e.stage})`;
    case 'collect_complete':
      return `Data lengkap terkumpul (niat: ${String(p.intent ?? '—')})`;
    case 'slot_missing':
      return `Masih kurang: ${String(p.slot ?? 'data')}`;
    case 'confirmation_sent':
      return 'Ringkasan konfirmasi dikirim ke warga';
    case 'mutation_executed':
      return `Tiket/permohonan dibuat: ${String(p.ticketId ?? p.reference ?? '—')}`;
    case 'fallback_ticket_created':
      return `Tiket darurat dibuat: ${String(p.ticketId ?? '—')} (perlu tindak lanjut manual)`;
    case 'identity_level_resolved':
      return `Level identitas: ${String(p.level ?? '—')}`;
    case 'quarantined':
      return `Pesan dikarantina (${String(p.reason ?? 'anomali')})`;
    case 'media_signal':
      return 'Warga melampirkan gambar';
    case 'ocr_prefill':
      return 'Data KTP terisi otomatis (perlu konfirmasi warga)';
    case 'ktp_verification_created':
      return 'Foto KTP diterima — menunggu verifikasi petugas';
    case 'csat_low_rating':
      return 'Warga memberi rating rendah — perlu follow-up';
    default:
      return null;
  }
}

/** Pure: build a staff-friendly summary from turn state + audit trail. */
export function buildHandoffSummary(input: HandoffSummaryInput): HandoffSummary {
  const publicSlots = Object.entries(input.slots ?? {})
    .filter(([k]) => !k.startsWith(INTERNAL_SLOT_PREFIX))
    .map(([key, value]) => ({ key, value: short(value) }));

  const timeline: string[] = [];
  for (const e of input.recentEvents.slice(-MAX_TIMELINE)) {
    const line = eventLine(e);
    if (line) timeline.push(line);
  }

  const intent = typeof input.slots?.intent === 'string' ? input.slots.intent : undefined;
  const pendingMutation = Boolean(input.slots?.pendingTool);

  const lines: string[] = [];
  lines.push(`Ringkasan percakapan — diambil alih oleh ${input.takenBy || 'petugas'}` +
    (input.reason ? ` (alasan: ${input.reason})` : ''));
  lines.push(`Tahap: ${input.stage}` +
    (intent ? ` · Niat: ${intent}` : '') +
    (input.identityLevel ? ` · Identitas: ${input.identityLevel}` : ''));
  if (publicSlots.length > 0) {
    lines.push('Data yang sudah terkumpul: ' +
      publicSlots.map((s) => `${s.key}=${s.value}`).join('; '));
  } else {
    lines.push('Belum ada data terisi.');
  }
  if (pendingMutation) {
    lines.push('⚠️ Ada tindakan yang MENUNGGU konfirmasi warga (tiket/permohonan belum dibuat).');
  }
  if (input.lastCitizenMessage) {
    lines.push(`Pesan terakhir warga: "${short(input.lastCitizenMessage)}"`);
  }
  if (timeline.length > 0) {
    lines.push('Jalannya percakapan: ' + timeline.join(' → '));
  }
  return {
    intent,
    stage: input.stage,
    identityLevel: input.identityLevel,
    filledSlots: publicSlots,
    pendingMutation,
    lastCitizenMessage: input.lastCitizenMessage,
    timeline,
    text: lines.join('\n'),
  };
}

/** Load recent audit events for a user (best-effort, newest last). */
export async function loadRecentUserEvents(
  tenantId: string, userId: string, channel = 'whatsapp', limit = 30,
): Promise<HandoffSummaryInput['recentEvents']> {
  const db = await getDb();
  if (!db) return [];
  try {
    const rows = (await db.$queryRawUnsafe(
      `SELECT stage, event, occurred_at, payload FROM pipeline_audit_events
        WHERE tenant_id=$1 AND user_id=$2 AND channel=$3
        ORDER BY occurred_at DESC LIMIT $4`,
      tenantId, userId, channel, limit,
    )) as Array<{ stage: string; event: string; occurred_at: Date; payload: unknown }>;
    return rows.reverse().map((r) => ({
      stage: r.stage,
      event: r.event,
      occurredAt: r.occurred_at instanceof Date ? r.occurred_at.toISOString() : String(r.occurred_at),
      payload: (r.payload ?? {}) as Record<string, unknown>,
    }));
  } catch {
    return [];
  }
}

export interface SaveHandoffSummaryInput {
  tenantId: string;
  userId: string;
  channel?: string;
  takenBy: string;
  reason?: string;
  summary: HandoffSummary;
}

/** Persist a handoff summary (best-effort; never throws). Returns the id or null. */
export async function saveHandoffSummary(input: SaveHandoffSummaryInput): Promise<string | null> {
  const db = await getDb();
  if (!db) return dbDown('saveHandoffSummary', null);
  const id = `HSO-${randomUUID().replace(/-/g, '').slice(0, 12).toUpperCase()}`;
  try {
    await db.$executeRawUnsafe(
      `INSERT INTO pipeline_handoff_summaries
         (id, tenant_id, user_id, channel, taken_by, reason, summary_json, summary_text)
       VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb,$8)`,
      id, input.tenantId, input.userId, input.channel ?? 'whatsapp',
      input.takenBy.slice(0, 200), (input.reason ?? '').slice(0, 500),
      JSON.stringify({
        intent: input.summary.intent,
        stage: input.summary.stage,
        identityLevel: input.summary.identityLevel,
        filledSlots: input.summary.filledSlots,
        pendingMutation: input.summary.pendingMutation,
        lastCitizenMessage: input.summary.lastCitizenMessage,
        timeline: input.summary.timeline,
      }),
      input.summary.text.slice(0, 4000),
    );
    return id;
  } catch (err) {
    logger.warn('[handoff-summary] save failed', {
      error: String((err as Error)?.message ?? err).slice(0, 120),
    });
    return null;
  }
}

/** Latest handoff summary for a conversation (for the dashboard). */
export async function getLatestHandoffSummary(
  tenantId: string, userId: string, channel = 'whatsapp',
): Promise<{ id: string; takenBy: string; reason: string; text: string; createdAt: string } | null> {
  const db = await getDb();
  if (!db) return dbDown('getLatestHandoffSummary', null);
  try {
    const rows = (await db.$queryRawUnsafe(
      `SELECT id, taken_by, reason, summary_text, created_at
         FROM pipeline_handoff_summaries
        WHERE tenant_id=$1 AND user_id=$2 AND channel=$3
        ORDER BY created_at DESC LIMIT 1`,
      tenantId, userId, channel,
    )) as Array<{ id: string; taken_by: string; reason: string; summary_text: string; created_at: Date }>;
    if (rows.length === 0) return null;
    const r = rows[0]!;
    return {
      id: r.id,
      takenBy: r.taken_by,
      reason: r.reason,
      text: r.summary_text,
      createdAt: r.created_at instanceof Date ? r.created_at.toISOString() : String(r.created_at),
    };
  } catch {
    return null;
  }
}

/** Idempotency helper: hash of summary content (avoid duplicate saves). */
export function summaryContentHash(summary: HandoffSummary): string {
  return createHash('sha256').update(summary.text).digest('hex').slice(0, 16);
}

export async function auditHandoffSummary(input: {
  tenantId: string; traceId: string; userId: string; channel: string; summaryId: string | null;
}): Promise<void> {
  await appendAudit({
    tenantId: input.tenantId, traceId: input.traceId, userId: input.userId,
    channel: input.channel, stage: 'HANDOFF', event: 'handoff_summary_saved',
    payload: { summaryId: input.summaryId },
  }).catch(() => undefined);
}
