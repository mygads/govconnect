/**
 * Tests for P1-4: soft-invalidated memories must never reach the agent.
 *
 * memoryInvalidateEntry() marks metadata_json.invalidated = true (soft
 * delete, audit trail survives). The read paths honor the flag:
 * - hybrid-memory.service: isMemoryInvalidated() filters lexical candidates
 *   (unit-tested here); the vector SQL joins entries and excludes
 *   invalidated rows at the DB level.
 * - pipeline-store.memoryFindByKey: SQL predicate
 *   (metadata_json->>'invalidated' IS DISTINCT FROM 'true').
 */

import { describe, it, expect, vi } from 'vitest';

// Heavy deps of hybrid-memory.service (real prisma client is unavailable in
// this environment); the helper under test is pure.
vi.mock('../../lib/prisma', () => ({ default: {} }));
vi.mock('../../services/embedding.service', () => ({ generateEmbedding: vi.fn() }));
vi.mock('../../services/runtime-observability.service', () => ({ recordMemoryTrace: vi.fn() }));
vi.mock('../../services/memory-vector.service', () => ({
  searchUserMemoryVectors: vi.fn(async () => []),
  upsertUserMemoryVector: vi.fn(async () => undefined),
}));

import { isMemoryInvalidated } from '../../services/hybrid-memory.service';

describe('P1-4: isMemoryInvalidated', () => {
  it('flags entries marked invalidated=true', () => {
    expect(isMemoryInvalidated({ metadata_json: { invalidated: true } })).toBe(true);
  });

  it('keeps entries without the flag', () => {
    expect(isMemoryInvalidated({ metadata_json: {} })).toBe(false);
    expect(isMemoryInvalidated({ metadata_json: { invalidated: false } })).toBe(false);
    expect(isMemoryInvalidated({})).toBe(false);
    expect(isMemoryInvalidated({ metadata_json: null })).toBe(false);
  });

  it('is strict: only boolean true counts', () => {
    expect(isMemoryInvalidated({ metadata_json: { invalidated: 'true' } })).toBe(false);
    expect(isMemoryInvalidated({ metadata_json: { invalidated: 1 } })).toBe(false);
  });

  it('filters a candidate list the way searchUserMemories does', () => {
    const candidates = [
      { id: 'a', metadata_json: { invalidated: true } },
      { id: 'b', metadata_json: {} },
      { id: 'c' },
    ];
    const live = candidates.filter((e) => !isMemoryInvalidated(e));
    expect(live.map((e) => e.id)).toEqual(['b', 'c']);
  });
});
