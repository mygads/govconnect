/**
 * Tests for the NLU few-shot examples service.
 *
 * Verifies per-village caching, prompt formatting, and safe behavior for
 * villages with no examples (empty string, never throws).
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

const testState = vi.hoisted(() => {
  const findMany = vi.fn(async (): Promise<any[]> => []);
  return {
    prismaMock: {
      ai_nlu_few_shot_examples: { findMany },
    },
    findMany,
  };
});

vi.mock('../../lib/prisma', () => ({
  default: testState.prismaMock,
}));

import {
  getFewShotExamples,
  getFewShotForPrompt,
  clearFewShotCache,
} from '../few-shot-examples.service';

describe('few-shot-examples service', () => {
  beforeEach(() => {
    testState.findMany.mockClear();
    testState.findMany.mockResolvedValue([]);
    clearFewShotCache();
  });

  it('returns [] and does NOT hit the DB when no villageId is given', async () => {
    const result = await getFewShotExamples(undefined);
    expect(result).toEqual([]);
    expect(testState.findMany).not.toHaveBeenCalled();
  });

  it('returns [] for a village with no examples', async () => {
    const result = await getFewShotExamples('village-1');
    expect(result).toEqual([]);
  });

  it('maps and trims DB rows into examples', async () => {
    testState.findMany.mockResolvedValueOnce([
      { utterance: '  badhe damel KK  ', correct_intent: 'service_info', correct_category: 'layanan_administrasi' },
      { utterance: 'nomor pak lurah', correct_intent: 'contact_lookup', correct_category: null },
    ]);
    const result = await getFewShotExamples('village-1');
    expect(result).toEqual([
      { utterance: 'badhe damel KK', correct_intent: 'service_info', correct_category: 'layanan_administrasi' },
      { utterance: 'nomor pak lurah', correct_intent: 'contact_lookup', correct_category: null },
    ]);
  });

  it('drops rows with blank utterances', async () => {
    testState.findMany.mockResolvedValueOnce([
      { utterance: '   ', correct_intent: 'service_info', correct_category: null },
      { utterance: 'valid', correct_intent: 'knowledge_query', correct_category: null },
    ]);
    const result = await getFewShotExamples('village-1');
    expect(result).toHaveLength(1);
    expect(result[0].utterance).toBe('valid');
  });

  it('caches per village — second call does not re-query', async () => {
    testState.findMany.mockResolvedValueOnce([
      { utterance: 'x', correct_intent: 'service_info', correct_category: null },
    ]);
    await getFewShotExamples('village-1');
    await getFewShotExamples('village-1');
    expect(testState.findMany).toHaveBeenCalledTimes(1);
  });

  it('clearFewShotCache(village) forces a re-query', async () => {
    testState.findMany.mockResolvedValue([
      { utterance: 'x', correct_intent: 'service_info', correct_category: null },
    ]);
    await getFewShotExamples('village-1');
    clearFewShotCache('village-1');
    await getFewShotExamples('village-1');
    expect(testState.findMany).toHaveBeenCalledTimes(2);
  });

  it('returns [] (never throws) when the DB query fails', async () => {
    testState.findMany.mockRejectedValueOnce(new Error('db down'));
    const result = await getFewShotExamples('village-1');
    expect(result).toEqual([]);
  });

  describe('getFewShotForPrompt', () => {
    it('returns empty string for a village with no examples', async () => {
      const block = await getFewShotForPrompt('village-empty');
      expect(block).toBe('');
    });

    it('formats examples with intent and category', async () => {
      testState.findMany.mockResolvedValueOnce([
        { utterance: 'badhe damel KK', correct_intent: 'service_info', correct_category: 'layanan_administrasi' },
      ]);
      const block = await getFewShotForPrompt('village-1');
      expect(block).toContain('CONTOH DARI DESA INI');
      expect(block).toContain('"badhe damel KK"');
      expect(block).toContain('routing_intent: "service_info"');
      expect(block).toContain('categories: ["layanan_administrasi"]');
    });

    it('omits categories clause when correct_category is null', async () => {
      testState.findMany.mockResolvedValueOnce([
        { utterance: 'nomor pak lurah', correct_intent: 'contact_lookup', correct_category: null },
      ]);
      const block = await getFewShotForPrompt('village-1');
      expect(block).toContain('routing_intent: "contact_lookup"');
      expect(block).not.toContain('categories:');
    });
  });
});
