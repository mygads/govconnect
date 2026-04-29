import { describe, it, expect } from 'vitest';
import { __test_only__ } from '../ai-gateway.service';

const { parsePromptRerankResults } = __test_only__;

describe('parsePromptRerankResults', () => {
  const docs = ['doc-A', 'doc-B', 'doc-C'];

  it('parses well-formed JSON and sorts by relevance', () => {
    const text = '{"results":[{"index":0,"relevance_score":0.5},{"index":2,"relevance_score":0.9}]}';
    const out = parsePromptRerankResults(text, docs, 5);
    expect(out).toHaveLength(2);
    expect(out[0].index).toBe(2);
    expect(out[1].index).toBe(0);
  });

  it('extracts JSON from surrounding prose', () => {
    const text = 'Sure! Here is the answer:\n{"results":[{"index":1,"relevance_score":0.7}]}\nThanks.';
    const out = parsePromptRerankResults(text, docs, 5);
    expect(out).toHaveLength(1);
    expect(out[0].index).toBe(1);
  });

  it('returns empty for malformed JSON instead of throwing', () => {
    const text = 'not actually json at all';
    const out = parsePromptRerankResults(text, docs, 5);
    expect(out).toEqual([]);
  });

  it('drops entries with out-of-range index', () => {
    const text = '{"results":[{"index":99,"relevance_score":1}]}';
    const out = parsePromptRerankResults(text, docs, 5);
    expect(out).toEqual([]);
  });
});
