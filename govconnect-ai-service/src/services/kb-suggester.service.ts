/**
 * R5: Knowledge suggester — DB-backed store + cron entry point.
 *
 * The deterministic mining core lives in kb-suggester-core.ts (prisma-free).
 * This module wires it to the audit trail and the ai.kb_proposals table.
 *
 * AI proposes, human approves (P14): runs are triggered by a daily/weekly
 * cron hitting POST /api/kb-proposals/suggest — NEVER on the hot path.
 */
import prisma from '../lib/prisma';
import logger from '../utils/logger';
import {
  mineProposals,
  canTransition,
  proposalId,
  type KbProposal,
  type ProposalStore,
  type SuggesterEvent,
} from './kb-suggester-core';

export {
  extractTopicKey,
  mineProposals,
  canTransition,
  proposalId,
} from './kb-suggester-core';
export type {
  KbProposal,
  ProposalStore,
  ProposalType,
  ProposalDraft,
  SuggesterEvent,
  MineOptions,
} from './kb-suggester-core';

function rowToProposal(r: Record<string, unknown>): KbProposal {
  return {
    id: String(r.id),
    villageId: String(r.village_id),
    type: r.type as KbProposal['type'],
    title: String(r.title),
    draft: String(r.draft),
    dedupeKey: String(r.dedupe_key),
    status: r.status as KbProposal['status'],
    source: (r.source ?? {}) as Record<string, unknown>,
    createdBy: String(r.created_by),
    createdAt: String(r.created_at),
    reviewedBy: (r.reviewed_by as string | null) ?? null,
    reviewedAt: r.reviewed_at ? String(r.reviewed_at) : null,
    reviewNote: (r.review_note as string | null) ?? null,
  };
}

/** Prisma-backed store. Requires the 20260929_kb_proposals migration. */
export const prismaProposalStore: ProposalStore = {
  async findActiveByDedupeKeys(villageId, keys) {
    if (keys.length === 0) return new Set();
    const rows = (await prisma.$queryRawUnsafe(
      `SELECT dedupe_key FROM ai.kb_proposals
       WHERE village_id = $1 AND dedupe_key = ANY($2)
         AND status IN ('pending','approved')`,
      villageId, keys,
    )) as Array<{ dedupe_key: string }>;
    return new Set(rows.map((r) => r.dedupe_key));
  },

  async insert(p) {
    await prisma.$executeRawUnsafe(
      `INSERT INTO ai.kb_proposals
         (id, village_id, type, title, draft, dedupe_key, status, source, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,'pending',$7::jsonb,$8)
       ON CONFLICT DO NOTHING`,
      p.id, p.villageId, p.type, p.title, p.draft, p.dedupeKey,
      JSON.stringify(p.source), p.createdBy,
    );
  },

  async list(villageId, status) {
    const rows = (await prisma.$queryRawUnsafe(
      `SELECT id, village_id, type, title, draft, dedupe_key, status, source,
              created_by, created_at, reviewed_by, reviewed_at, review_note
       FROM ai.kb_proposals WHERE village_id = $1
       ${status ? 'AND status = $2' : ''}
       ORDER BY created_at DESC LIMIT 200`,
      ...(status ? [villageId, status] : [villageId]),
    )) as Array<Record<string, unknown>>;
    return rows.map(rowToProposal);
  },

  async get(id) {
    const rows = (await prisma.$queryRawUnsafe(
      `SELECT id, village_id, type, title, draft, dedupe_key, status, source,
              created_by, created_at, reviewed_by, reviewed_at, review_note
       FROM ai.kb_proposals WHERE id = $1`,
      id,
    )) as Array<Record<string, unknown>>;
    return rows.length > 0 ? rowToProposal(rows[0]) : null;
  },

  async setStatus(id, status, reviewer, note) {
    const current = await this.get(id);
    if (!current) return null;
    if (!canTransition(current.status, status)) return null;
    await prisma.$executeRawUnsafe(
      `UPDATE ai.kb_proposals
       SET status = $2, reviewed_by = $3, reviewed_at = now(), review_note = $4
       WHERE id = $1`,
      id, status, reviewer, note ?? null,
    );
    return this.get(id);
  },
};

export interface SuggestOptions {
  villageId: string;
  days?: number;
  minCount?: number;
  store?: ProposalStore;
}

/**
 * Run the suggester for one village: mine the audit window, dedupe against
 * active proposals, insert new pending drafts. Returns the new proposals.
 */
export async function runSuggesterForVillage(opts: SuggestOptions): Promise<KbProposal[]> {
  const { villageId, days = 7, minCount, store = prismaProposalStore } = opts;
  const windowLabel = `${days} hari terakhir`;

  const events = (await prisma.$queryRawUnsafe(
    `SELECT trace_id, stage, event, payload, occurred_at
     FROM pipeline_audit_events
     WHERE tenant_id = $1 AND occurred_at >= now() - ($2 || ' days')::interval
       AND event IN ('turn_completed','handoff_after_repeated_failure',
                     'slot_missing','fallback_ticket_issued')
     ORDER BY occurred_at ASC
     LIMIT 20000`,
    villageId, String(days),
  )) as Array<{
    trace_id: string; stage: string; event: string;
    payload: Record<string, unknown>; occurred_at: Date;
  }>;

  const drafts = mineProposals(
    events.map((e): SuggesterEvent => ({
      traceId: e.trace_id,
      stage: e.stage,
      event: e.event,
      payload: e.payload ?? {},
      occurredAt: String(e.occurred_at),
    })),
    { minCount, windowLabel },
  );
  if (drafts.length === 0) {
    logger.info('[kb-suggester] no proposals', { villageId, events: events.length });
    return [];
  }

  const active = await store.findActiveByDedupeKeys(
    villageId, drafts.map((d) => d.dedupeKey),
  );
  const fresh = drafts.filter((d) => !active.has(d.dedupeKey));
  const created: KbProposal[] = [];
  for (const d of fresh) {
    const p: KbProposal = {
      id: proposalId(),
      villageId,
      type: d.type,
      title: d.title,
      draft: d.draft,
      dedupeKey: d.dedupeKey,
      status: 'pending',
      source: d.source,
      createdBy: 'suggester',
      createdAt: new Date().toISOString(),
    };
    await store.insert(p);
    created.push(p);
  }
  logger.info('[kb-suggester] proposals created', {
    villageId, mined: drafts.length, created: created.length,
    deduped: drafts.length - fresh.length,
  });
  return created;
}
