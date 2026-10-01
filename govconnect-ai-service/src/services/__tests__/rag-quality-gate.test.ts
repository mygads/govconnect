/**
 * W9: unit tests untuk rag-quality-gate.service.ts.
 *
 * Menguji klasifikasi kualitas retrieval:
 * - HIGH   : top1 >= 0.85
 * - MEDIUM : 0.65 <= top1 < 0.85
 * - LOW    : top1 < 0.65, atau gap(top1-top2) < 0.05, atau tanpa hasil
 */
import { describe, it, expect, vi } from 'vitest';

// Mock lib/prisma sebelum import module under test (module mengimpor prisma
// di top-level untuk persistensi metrik).
vi.mock('../../lib/prisma', () => ({
  default: {
    $executeRawUnsafe: vi.fn().mockResolvedValue(1),
  },
}));

import {
  evaluateRAGQuality,
  RAG_QUALITY_HIGH_MIN,
  RAG_QUALITY_MEDIUM_MIN,
  RAG_QUALITY_MIN_GAP,
} from '../rag-quality-gate.service';

describe('rag-quality-gate (W9)', () => {
  it('threshold default sesuai spesifikasi: HIGH>=0.85, MEDIUM>=0.65, gap<0.05', () => {
    expect(RAG_QUALITY_HIGH_MIN).toBe(0.85);
    expect(RAG_QUALITY_MEDIUM_MIN).toBe(0.65);
    expect(RAG_QUALITY_MIN_GAP).toBe(0.05);
  });

  it('HIGH: top1 >= 0.85 dengan gap jelas', () => {
    const q = evaluateRAGQuality([0.92, 0.7, 0.6]);
    expect(q.level).toBe('HIGH');
    expect(q.top1Score).toBeCloseTo(0.92);
    expect(q.top2Score).toBeCloseTo(0.7);
    expect(q.scoreGap).toBeCloseTo(0.22);
    expect(q.resultCount).toBe(3);
    expect(q.avgScore).toBeCloseTo((0.92 + 0.7 + 0.6) / 3);
    expect(q.reasons.length).toBeGreaterThan(0);
  });

  it('HIGH: satu hasil kuat (tanpa pembanding gap)', () => {
    const q = evaluateRAGQuality([0.9]);
    expect(q.level).toBe('HIGH');
    expect(q.top2Score).toBeNull();
    expect(q.resultCount).toBe(1);
  });

  it('HIGH: tepat di batas 0.85', () => {
    expect(evaluateRAGQuality([0.85, 0.5]).level).toBe('HIGH');
  });

  it('MEDIUM: top1 dalam [0.65, 0.85)', () => {
    const q = evaluateRAGQuality([0.72, 0.6, 0.55]);
    expect(q.level).toBe('MEDIUM');
    expect(q.top1Score).toBeCloseTo(0.72);
  });

  it('MEDIUM: tepat di batas 0.65', () => {
    expect(evaluateRAGQuality([0.65, 0.5]).level).toBe('MEDIUM');
  });

  it('LOW: top1 < 0.65', () => {
    const q = evaluateRAGQuality([0.5, 0.45, 0.4]);
    expect(q.level).toBe('LOW');
    expect(q.reasons.join(' ')).toMatch(/0\.65/);
  });

  it('LOW: ranking ambigu — gap top1-top2 < 0.05 walau skor absolut tinggi', () => {
    const q = evaluateRAGQuality([0.93, 0.91, 0.6]);
    expect(q.level).toBe('LOW');
    expect(q.scoreGap).toBeCloseTo(0.02);
    expect(q.reasons.join(' ')).toMatch(/ambiguous/);
  });

  it('LOW: tanpa hasil sama sekali', () => {
    const q = evaluateRAGQuality([]);
    expect(q.level).toBe('LOW');
    expect(q.top1Score).toBe(0);
    expect(q.top2Score).toBeNull();
    expect(q.resultCount).toBe(0);
    expect(q.avgScore).toBe(0);
  });

  it('mengabaikan skor non-finite', () => {
    const q = evaluateRAGQuality([0.9, NaN, Infinity, 0.7]);
    expect(q.level).toBe('HIGH');
    expect(q.resultCount).toBe(2);
  });

  it('tidak mengubah urutan input', () => {
    const scores = [0.6, 0.9, 0.7];
    evaluateRAGQuality(scores);
    expect(scores).toEqual([0.6, 0.9, 0.7]);
  });
});
