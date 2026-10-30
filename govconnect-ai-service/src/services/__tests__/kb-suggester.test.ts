/**
 * R5: knowledge suggester + proposal approval — unit tests.
 *
 * Covers the deterministic core (topic key, mining, transitions) with an
 * in-memory store fake. The prisma-backed store is not hit here (no live DB).
 */
import { describe, it, expect } from 'vitest';
import {
  extractTopicKey,
  mineProposals,
  canTransition,
  type SuggesterEvent,
  type KbProposal,
  type ProposalStore,
} from '../kb-suggester-core';

let traceSeq = 0;
function turn(
  topic: string,
  overrides: Partial<SuggesterEvent> = {},
): SuggesterEvent {
  traceSeq++;
  return {
    traceId: `t_det_${traceSeq}`,
    stage: 'INFORMATION',
    event: 'turn_completed',
    payload: { degraded: true, toolsUsed: [], topic },
    occurredAt: '2026-09-29T00:00:00Z',
    ...overrides,
  };
}

describe('extractTopicKey', () => {
  it('clusters word-order variants together', () => {
    expect(extractTopicKey('syarat SKTM')).toBe(extractTopicKey('SKTM syarat'));
  });

  it('removes Indonesian stopwords and short words', () => {
    const k = extractTopicKey('tolong bagaimana syarat sktm');
    expect(k).not.toContain('tolong');
    expect(k).not.toContain('bagaimana');
    expect(k).toContain('syarat');
  });

  it('caps at 3 keywords, sorted', () => {
    const k = extractTopicKey('zebra apel mangga nanas durian');
    expect(k.split('+')).toHaveLength(3);
    expect(k.split('+')).toEqual([...k.split('+')].sort());
  });

  it('returns empty string for empty/stopword-only input', () => {
    expect(extractTopicKey('')).toBe('');
    expect(extractTopicKey('tolong ya dong')).toBe('');
  });
});

describe('mineProposals — content_gap', () => {
  it('proposes when the same topic fails 5+ times', () => {
    const events = Array.from({ length: 6 }, () => turn('sktm+syarat'));
    const drafts = mineProposals(events, { windowLabel: '7 hari terakhir' });
    expect(drafts).toHaveLength(1);
    expect(drafts[0].type).toBe('content_gap');
    expect(drafts[0].dedupeKey).toBe('content_gap:sktm+syarat');
    expect(drafts[0].source.count).toBe(6);
  });

  it('stays silent below the threshold', () => {
    const events = Array.from({ length: 4 }, () => turn('sktm+syarat'));
    expect(mineProposals(events)).toHaveLength(0);
  });

  it('ignores satisfied turns (not degraded, tools used)', () => {
    const events = Array.from({ length: 9 }, () =>
      turn('sktm+syarat', { payload: { degraded: false, toolsUsed: ['search_knowledge'], topic: 'sktm+syarat' } }),
    );
    expect(mineProposals(events)).toHaveLength(0);
  });

  it('counts no-tool-evidence turns even when not degraded', () => {
    const events = Array.from({ length: 5 }, () =>
      turn('akta+kelahiran', { payload: { degraded: false, toolsUsed: [], topic: 'akta+kelahiran' } }),
    );
    const drafts = mineProposals(events);
    expect(drafts).toHaveLength(1);
    expect(drafts[0].type).toBe('content_gap');
  });

  it('ignores non-INFORMATION stages and empty topics', () => {
    const events = [
      ...Array.from({ length: 6 }, () => turn('', { payload: { degraded: true, toolsUsed: [], topic: '' } })),
      ...Array.from({ length: 6 }, () => turn('x', { stage: 'COLLECT', payload: { degraded: true, toolsUsed: [], topic: 'x' } })),
    ];
    expect(mineProposals(events)).toHaveLength(0);
  });
});

describe('mineProposals — data_gap / action_gap', () => {
  it('proposes data_gap after 3 repeated missing slots', () => {
    const events = Array.from({ length: 3 }, (_, i) => ({
      traceId: `s${i}`,
      stage: 'COLLECT',
      event: 'slot_missing',
      payload: { slot: 'reporterName' },
      occurredAt: '2026-09-29T00:00:00Z',
    }));
    const drafts = mineProposals(events);
    expect(drafts).toHaveLength(1);
    expect(drafts[0].type).toBe('data_gap');
    expect(drafts[0].dedupeKey).toBe('data_gap:slot:reporterName');
  });

  it('proposes action_gap after 5 repeated fallbacks on one intent', () => {
    const events = Array.from({ length: 5 }, (_, i) => ({
      traceId: `f${i}`,
      stage: 'INGRESS',
      event: 'fallback_ticket_issued',
      payload: { intentHint: 'information' },
      occurredAt: '2026-09-29T00:00:00Z',
    }));
    const drafts = mineProposals(events);
    expect(drafts).toHaveLength(1);
    expect(drafts[0].type).toBe('action_gap');
  });
});

describe('mineProposals — determinism', () => {
  it('returns identical drafts for identical input (shuffled)', () => {
    const events: SuggesterEvent[] = [
      ...Array.from({ length: 6 }, (_, i) => ({
        traceId: `det_t${i}`, stage: 'INFORMATION', event: 'turn_completed',
        payload: { degraded: true, toolsUsed: [], topic: 'sktm+syarat' },
        occurredAt: '2026-09-29T00:00:00Z',
      })),
      ...Array.from({ length: 5 }, (_, i) => ({
        traceId: `det_f${i}`, stage: 'INGRESS', event: 'fallback_ticket_issued',
        payload: { intentHint: 'information' }, occurredAt: '2026-09-29T00:00:00Z',
      })),
    ];
    const a = mineProposals(events);
    const b = mineProposals([...events].reverse());
    expect(a).toEqual(b);
  });
});

describe('canTransition', () => {
  it('allows pending → approved / rejected only', () => {
    expect(canTransition('pending', 'approved')).toBe(true);
    expect(canTransition('pending', 'rejected')).toBe(true);
    expect(canTransition('pending', 'published')).toBe(false);
    expect(canTransition('pending', 'withdrawn')).toBe(false);
  });

  it('allows approved → published / withdrawn (explicit human step, never automatic)', () => {
    expect(canTransition('approved', 'published')).toBe(true);
    expect(canTransition('approved', 'withdrawn')).toBe(true);
    expect(canTransition('approved', 'rejected')).toBe(false);
  });

  it('terminal states cannot move', () => {
    for (const s of ['rejected', 'published', 'withdrawn'] as const) {
      expect(canTransition(s, 'approved')).toBe(false);
      expect(canTransition(s, 'rejected')).toBe(false);
    }
  });
});

/** In-memory store fake for the approve/reject flow. */
function memoryStore(): ProposalStore & { touchedDocuments: string[] } {
  const map = new Map<string, KbProposal>();
  return {
    touchedDocuments: [],
    async findActiveByDedupeKeys(_v, keys) {
      return new Set([...map.values()].filter((p) => keys.includes(p.dedupeKey) && ['pending', 'approved'].includes(p.status)).map((p) => p.dedupeKey));
    },
    async insert(p) { map.set(p.id, { ...p, createdAt: new Date().toISOString() }); },
    async list(v, s) { return [...map.values()].filter((p) => p.villageId === v && (!s || p.status === s)); },
    async get(id) { return map.get(id) ?? null; },
    async setStatus(id, status, reviewer, note) {
      const cur = map.get(id);
      if (!cur || !canTransition(cur.status, status)) return null;
      const next = { ...cur, status, reviewedBy: reviewer, reviewedAt: new Date().toISOString(), reviewNote: note ?? null };
      map.set(id, next);
      return next;
    },
  };
}

describe('approve/reject flow — no auto-promote', () => {
  const draft = {
    id: 'kbp_test1', villageId: 'desa-1', type: 'content_gap' as const,
    title: 'Konten kurang', draft: 'usulan...', dedupeKey: 'content_gap:sktm+syarat',
    status: 'pending' as const, source: {}, createdBy: 'suggester',
    createdAt: new Date().toISOString(),
  };

  it('approve flips status and records the reviewer, nothing else', async () => {
    const store = memoryStore();
    await store.insert(draft);
    const p = await store.setStatus('kbp_test1', 'approved', 'admin_desa', 'setuju');
    expect(p?.status).toBe('approved');
    expect(p?.reviewedBy).toBe('admin_desa');
    expect(p?.reviewNote).toBe('setuju');
    // No auto-promote: status is 'approved', not 'published'; no document touched.
    expect(p?.status).not.toBe('published');
    expect(store.touchedDocuments).toHaveLength(0);
  });

  it('reject flips status', async () => {
    const store = memoryStore();
    await store.insert(draft);
    const p = await store.setStatus('kbp_test1', 'rejected', 'admin_desa', 'belum perlu');
    expect(p?.status).toBe('rejected');
  });

  it('double approval is rejected by the transition guard', async () => {
    const store = memoryStore();
    await store.insert(draft);
    await store.setStatus('kbp_test1', 'approved', 'admin_desa');
    const again = await store.setStatus('kbp_test1', 'approved', 'admin_desa');
    expect(again).toBeNull();
  });
});
