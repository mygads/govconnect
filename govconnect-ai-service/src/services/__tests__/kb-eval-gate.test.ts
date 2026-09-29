/**
 * W9: unit tests untuk kb-eval-gate.service.ts.
 * Menguji logika threshold (recall@20 ≥ 0.85, refusal precision ≥ 0.95),
 * fail-closed saat DB error, dan skip saat KB kosong.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock hybrid-search sebelum import module under test.
vi.mock('../hybrid-search.service', () => ({
  hybridSearch: vi.fn(),
}));

// Mock lib/prisma.
vi.mock('../../lib/prisma', () => ({
  default: {
    $queryRawUnsafe: vi.fn(),
  },
}));

import { hybridSearch } from '../hybrid-search.service';
import prisma from '../../lib/prisma';
import {
  runKbEvalGate,
  KB_EVAL_RECALL_AT_20_MIN,
  KB_EVAL_REFUSAL_PRECISION_MIN,
} from '../kb-eval-gate.service';

const mockHybridSearch = vi.mocked(hybridSearch);
const mockQueryRaw = vi.mocked(prisma.$queryRawUnsafe);

describe('kb-eval-gate (W9)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('threshold default sesuai arsitektur: recall@20 ≥ 0.85, refusal precision ≥ 0.95', () => {
    expect(KB_EVAL_RECALL_AT_20_MIN).toBe(0.85);
    expect(KB_EVAL_REFUSAL_PRECISION_MIN).toBe(0.95);
  });

  it('pass bila recall dan refusal di atas threshold', async () => {
    mockQueryRaw.mockResolvedValue([
      { id: 'doc1', title: 'Syarat KTP' },
      { id: 'doc2', title: 'Jam pelayanan' },
    ]);
    // Recall probe: dokumen sumber selalu ketemu di top-20.
    // Refusal probe: tidak ada hasil (refusal benar).
    mockHybridSearch.mockImplementation(async (query: string) => {
      if (query === 'Syarat KTP') return [{ id: 'doc1' }] as any;
      if (query === 'Jam pelayanan') return [{ id: 'doc2' }] as any;
      return []; // refusal probes → no hits
    });

    const result = await runKbEvalGate('TEST-DESA-A');
    expect(result.pass).toBe(true);
    expect(result.recallAt20).toBe(1);
    expect(result.refusalPrecision).toBe(1);
    expect(result.failures).toHaveLength(0);
    expect(result.skippedEmptyKb).toBe(false);
  });

  it('fail bila recall@20 di bawah 0.85', async () => {
    mockQueryRaw.mockResolvedValue([
      { id: 'doc1', title: 'Syarat KTP' },
      { id: 'doc2', title: 'Jam pelayanan' },
    ]);
    mockHybridSearch.mockImplementation(async (query: string) => {
      if (query === 'Syarat KTP') return [{ id: 'doc1' }] as any;
      // doc2 tidak ketemu → recall 0.5
      return [];
    });

    const result = await runKbEvalGate('TEST-DESA-A');
    expect(result.pass).toBe(false);
    expect(result.recallAt20).toBe(0.5);
    expect(result.failures.some((f) => f.includes('recall@20'))).toBe(true);
  });

  it('fail bila refusal precision di bawah 0.95', async () => {
    mockQueryRaw.mockResolvedValue([{ id: 'doc1', title: 'Syarat KTP' }]);
    mockHybridSearch.mockImplementation(async (query: string) => {
      if (query === 'Syarat KTP') return [{ id: 'doc1' }] as any;
      // Semua refusal probe mengembalikan hasil → 0 correct refusals
      return [{ id: 'docX' }] as any;
    });

    const result = await runKbEvalGate('TEST-DESA-A');
    expect(result.pass).toBe(false);
    expect(result.refusalPrecision).toBe(0);
    expect(result.failures.some((f) => f.includes('refusal_precision'))).toBe(true);
  });

  it('skip (pass) bila KB kosong — tidak ada yang diukur', async () => {
    mockQueryRaw.mockResolvedValue([]);
    const result = await runKbEvalGate('TEST-DESA-EMPTY');
    expect(result.pass).toBe(true);
    expect(result.skippedEmptyKb).toBe(true);
    expect(mockHybridSearch).not.toHaveBeenCalled();
  });

  it('fail-closed bila database error', async () => {
    mockQueryRaw.mockRejectedValue(new Error('connection refused'));
    const result = await runKbEvalGate('TEST-DESA-A');
    expect(result.pass).toBe(false);
    expect(result.failures.some((f) => f.includes('fail-closed'))).toBe(true);
  });
});
