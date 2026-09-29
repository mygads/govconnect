/**
 * A6: small-tier routing tests (mock fetchFn — no network, no model download).
 */
import { describe, it, expect } from 'vitest';
import {
  getSmallTierConfig, isSmallTierEnabled, callSmallTier,
  type SmallTierConfig,
} from '../small-tier';

const CFG: SmallTierConfig = {
  enabled: true,
  baseUrl: 'http://localhost:11434/v1',
  model: 'qwen2.5:7b',
  apiKey: '',
  timeoutMs: 5000,
};

function okFetch(body: unknown, model = 'qwen2.5:7b') {
  return async (_url: string, _init?: Record<string, unknown>) => ({
    ok: true,
    status: 200,
    json: async () => ({ model, choices: [{ message: { content: JSON.stringify(body) } }] }),
  });
}

describe('getSmallTierConfig / isSmallTierEnabled', () => {
  it('defaults to OFF', () => {
    const cfg = getSmallTierConfig({});
    expect(cfg.enabled).toBe(false);
    expect(isSmallTierEnabled(cfg)).toBe(false);
  });

  it('enabled only when flag + baseUrl + model are all set', () => {
    expect(isSmallTierEnabled(CFG)).toBe(true);
    expect(isSmallTierEnabled({ ...CFG, enabled: false })).toBe(false);
    expect(isSmallTierEnabled({ ...CFG, baseUrl: '' })).toBe(false);
    expect(isSmallTierEnabled({ ...CFG, model: '' })).toBe(false);
  });
});

describe('callSmallTier', () => {
  it('returns null silently when disabled (default-off)', async () => {
    const r = await callSmallTier(
      [{ role: 'system', content: 'hi' }],
      { config: { ...CFG, enabled: false }, fetchFn: okFetch({}) },
    );
    expect(r).toBeNull();
  });

  it('routes to the OpenAI-compatible endpoint and returns text', async () => {
    let seenUrl = '';
    let seenBody: any;
    const fetchFn = async (url: string, init?: Record<string, unknown>) => {
      seenUrl = url;
      seenBody = JSON.parse(String(init?.body ?? '{}'));
      return { ok: true, status: 200, json: async () => ({ model: 'qwen2.5:7b', choices: [{ message: { content: 'ok-result' } }] }) };
    };
    const r = await callSmallTier(
      [{ role: 'system', content: 'classify' }],
      { config: CFG, fetchFn },
    );
    expect(r).toEqual({ text: 'ok-result', model: 'qwen2.5:7b' });
    expect(seenUrl).toBe('http://localhost:11434/v1/chat/completions');
    expect(seenBody.model).toBe('qwen2.5:7b');
    expect(seenBody.messages).toEqual([{ role: 'system', content: 'classify' }]);
  });

  it('falls back (null) on non-2xx', async () => {
    const r = await callSmallTier(
      [{ role: 'system', content: 'x' }],
      { config: CFG, fetchFn: async () => ({ ok: false, status: 500, json: async () => ({}) }) },
    );
    expect(r).toBeNull();
  });

  it('falls back (null) on network error — never throws', async () => {
    const r = await callSmallTier(
      [{ role: 'system', content: 'x' }],
      {
        config: CFG,
        fetchFn: async () => { throw new Error('ECONNREFUSED'); },
      },
    );
    expect(r).toBeNull();
  });

  it('falls back (null) on malformed payload', async () => {
    const badFetch = async () => ({
      ok: true, status: 200, json: async () => ({ choices: [] }),
    });
    const r = await callSmallTier(
      [{ role: 'system', content: 'x' }],
      { config: CFG, fetchFn: badFetch },
    );
    expect(r).toBeNull();
  });

  it('sends Bearer header only when an API key is set', async () => {
    let seenHeaders: any;
    const fetchFn = async (_url: string, init?: Record<string, unknown>) => {
      seenHeaders = init?.headers;
      return { ok: true, status: 200, json: async () => ({ choices: [{ message: { content: 't' } }] }) };
    };
    await callSmallTier([{ role: 'user', content: 'x' }], { config: CFG, fetchFn });
    expect(seenHeaders.authorization).toBeUndefined();
    await callSmallTier([{ role: 'user', content: 'x' }], { config: { ...CFG, apiKey: 'k' }, fetchFn });
    expect(seenHeaders.authorization).toBe('Bearer k');
  });
});
