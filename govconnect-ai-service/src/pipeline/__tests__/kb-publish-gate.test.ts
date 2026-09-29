/**
 * A3: KB publish review gate (§5.2) — mocked DB, no Postgres.
 *
 * - new ingests must enter as draft (enforced via DocumentChunkInput.publishStatus
 *   default + INSERT/upsert carrying publish_status);
 * - retrieval (dense + keyword) must only serve publish_status='published';
 * - set/getDocumentPublishStatus must target the right rows.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { prismaMock, queryRawCalls, executeRawCalls } = vi.hoisted(() => {
  const queryRawCalls: any[][] = [];
  const executeRawCalls: any[][] = [];
  const prismaMock = {
    $queryRaw: vi.fn(async (...args: any[]) => {
      queryRawCalls.push(args);
      return (prismaMock as any).__queryRawResult ?? [];
    }),
    $executeRaw: vi.fn(async (...args: any[]) => {
      executeRawCalls.push(args);
      return (prismaMock as any).__executeRawResult ?? 0;
    }),
  };
  return { prismaMock, queryRawCalls, executeRawCalls };
});

vi.mock('../../lib/prisma', () => ({ default: prismaMock }));

import {
  searchVectors,
  setDocumentPublishStatus,
  getDocumentPublishStatus,
  isValidPublishStatus,
} from '../../services/vector-db.service';
import { searchKeywords } from '../../services/hybrid-search.service';

function collectSql(call: any[]): string {
  // prisma.$queryRaw`...${prismaFragment}...` passes (strings, ...values);
  // Prisma.sql`...` fragments arrive inside values as { sql, values }.
  const parts: string[] = [];
  const strings = call[0];
  if (Array.isArray(strings)) parts.push(strings.join('?'));
  const walk = (v: any) => {
    if (v && typeof v === 'object') {
      if (typeof v.sql === 'string' && Array.isArray(v.values)) {
        parts.push(v.sql);
        for (const inner of v.values) walk(inner);
      } else if (Array.isArray(v)) {
        for (const inner of v) walk(inner);
      }
    }
  };
  for (const v of call.slice(1)) walk(v);
  return parts.join('\n');
}

function allQuerySql(): string {
  return queryRawCalls.map(collectSql).join('\n');
}

const FAKE_EMBEDDING = Array.from({ length: 16 }, (_, i) => 0.01 * (i + 1));

beforeEach(() => {
  vi.clearAllMocks();
  queryRawCalls.length = 0;
  executeRawCalls.length = 0;
  (prismaMock as any).__queryRawResult = [];
  (prismaMock as any).__executeRawResult = 0;
});

describe('isValidPublishStatus', () => {
  it('accepts the four lifecycle states', () => {
    for (const s of ['draft', 'published', 'withdrawn', 'superseded']) {
      expect(isValidPublishStatus(s)).toBe(true);
    }
  });

  it('rejects anything else', () => {
    for (const s of ['archived', 'pending', '', 'PUBLISHED', null, undefined, 42]) {
      expect(isValidPublishStatus(s)).toBe(false);
    }
  });
});

describe('dense retrieval publish gate', () => {
  it('filters document vectors to publish_status = published (village-scoped)', async () => {
    await searchVectors(FAKE_EMBEDDING, { villageId: 'v1', sourceTypes: ['document'], topK: 3 });
    const sql = allQuerySql();
    expect(sql).toContain('ai.document_vectors');
    expect(sql).toContain("publish_status = 'published'");
  });

  it('filters document vectors to published in the global branch too', async () => {
    await searchVectors(FAKE_EMBEDDING, { sourceTypes: ['document'], topK: 3 });
    const sql = allQuerySql();
    expect(sql).toContain("publish_status = 'published'");
  });

  it('does not apply the document publish filter to knowledge vectors', async () => {
    await searchVectors(FAKE_EMBEDDING, { villageId: 'v1', sourceTypes: ['knowledge'], topK: 3 });
    const sql = allQuerySql();
    expect(sql).toContain('ai.knowledge_vectors');
    expect(sql).not.toContain('publish_status');
  });
});

describe('keyword retrieval publish gate', () => {
  it('filters document keyword search to publish_status = published', async () => {
    await searchKeywords('surat keterangan domisili', { villageId: 'v1', sourceTypes: ['document'], topK: 3 });
    const sql = allQuerySql();
    expect(sql).toContain('ai.document_vectors');
    expect(sql).toContain("publish_status = 'published'");
  });
});

describe('setDocumentPublishStatus', () => {
  it('updates publish_status for the document id and returns affected rows', async () => {
    (prismaMock as any).__executeRawResult = 7;
    const n = await setDocumentPublishStatus('doc-1', 'published');
    expect(n).toBe(7);
    const sql = collectSql(executeRawCalls[0]);
    expect(sql).toContain('UPDATE ai.document_vectors');
    expect(sql).toContain('publish_status');
  });

  it('only accepts valid statuses at the type level (runtime guard exists)', () => {
    expect(isValidPublishStatus('withdrawn')).toBe(true);
  });
});

describe('getDocumentPublishStatus', () => {
  it('returns null when the document has no vectors', async () => {
    (prismaMock as any).__queryRawResult = [];
    await expect(getDocumentPublishStatus('doc-x')).resolves.toBeNull();
  });

  it('returns the stored status for existing vectors', async () => {
    (prismaMock as any).__queryRawResult = [{ publish_status: 'draft' }];
    await expect(getDocumentPublishStatus('doc-1')).resolves.toBe('draft');
  });

  it('returns null for unrecognized stored values instead of leaking them', async () => {
    (prismaMock as any).__queryRawResult = [{ publish_status: 'weird' }];
    await expect(getDocumentPublishStatus('doc-1')).resolves.toBeNull();
  });
});
