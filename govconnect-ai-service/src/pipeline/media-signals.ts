/**
 * A4 — admin review of media fraud signals.
 *
 * Fraud signals are persisted WITH the evidence audit event
 * (pipeline_audit_events, event='media_signal', payload.fraud_signals).
 * This module reads them back for the admin review queue.
 * Fail-soft: returns [] when the DB/table is unavailable.
 */
import { getDb, dbDown } from './pipeline-store';

export interface MediaSignalReview {
  occurred_at: string;
  user_id: string;
  trace_id: string;
  fraud_signals: string[];
  sha256: string | null;
  duplicate: boolean;
}

const MAX_LIMIT = 100;

export async function listRecentMediaSignals(
  villageId: string,
  limit = 50,
): Promise<MediaSignalReview[]> {
  const db = await getDb();
  if (!db) return dbDown('listRecentMediaSignals', []);
  const safeLimit = Math.min(Math.max(Math.floor(limit) || 50, 1), MAX_LIMIT);
  try {
    const rows = await db.$queryRawUnsafe<Array<{
      occurred_at: Date | string;
      user_id: string;
      trace_id: string;
      payload: {
        fraud_signals?: string[];
        sha256?: string | null;
        duplicate?: boolean;
      } | null;
    }>>(
      `SELECT occurred_at, user_id, trace_id, payload
         FROM pipeline_audit_events
        WHERE tenant_id = $1
          AND event = 'media_signal'
          AND (payload->>'fraud_signals') IS NOT NULL
          AND jsonb_array_length(payload->'fraud_signals') > 0
        ORDER BY occurred_at DESC
        LIMIT $2`,
      villageId, safeLimit,
    );
    return rows.map((r) => ({
      occurred_at: r.occurred_at instanceof Date ? r.occurred_at.toISOString() : String(r.occurred_at),
      user_id: r.user_id,
      trace_id: r.trace_id,
      fraud_signals: Array.isArray(r.payload?.fraud_signals) ? r.payload.fraud_signals : [],
      sha256: r.payload?.sha256 ?? null,
      duplicate: r.payload?.duplicate === true,
    }));
  } catch {
    // Table may not exist yet (migration not applied) — fail soft.
    return [];
  }
}
