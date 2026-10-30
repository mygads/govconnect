/**
 * BUG-008 — empty-content retry in callAIGatewayPrompt.
 *
 * Free-tier models frequently return a 200 with empty `content` (transient).
 * The gateway must retry the SAME model+key once before cascading to the
 * next model in the priority list.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const fetchMock = vi.hoisted(() => vi.fn());

const testGatewayConfig: any = {
  enabled: true,
  provider: 'openrouter',
  baseUrl: 'https://openrouter.ai/api/v1',
  apiKeys: ['test-key-1'],
  defaultHeaders: {},
  openRouterSiteUrl: '',
  openRouterAppName: '',
  openRouterProviderOrder: [],
  openRouterAllowFallbacks: false,
  openRouterRequireParameters: false,
  openRouterZDROnly: false,
  openRouterCacheEnabled: false,
  openRouterCacheTtlSeconds: 0,
  model: 'test-model',
  timeoutMs: 5000,
  chatCompletionsPath: '/chat/completions',
};

vi.mock('../ai-runtime-config.service', () => ({
  getRuntimeGatewayConfig: vi.fn(async () => ({
    config: testGatewayConfig,
    attempts: [{ config: testGatewayConfig }],
    meta: {},
  })),
  onRuntimeGatewayConfigCacheClear: vi.fn(),
}));

vi.stubGlobal('fetch', fetchMock);

import { callAIGatewayPrompt, clearGatewayBreaker } from '../ai-gateway.service';

function chatResponse(content: string | null) {
  return {
    ok: true,
    status: 200,
    headers: new Headers(),
    text: async () => JSON.stringify({
      id: 'gen-1',
      model: 'test-model',
      choices: [{ message: { content, role: 'assistant' }, finish_reason: 'stop' }],
      usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
    }),
  };
}

const baseOptions: any = {
  lane: 'llm',
  modelPriority: [],
  messages: [{ role: 'user', content: 'halo' }],
  temperature: 0.2,
  maxTokens: 100,
};

beforeEach(() => {
  fetchMock.mockReset();
  clearGatewayBreaker('llm:openrouter:https://openrouter.ai/api/v1');
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.stubGlobal('fetch', fetchMock);
});

describe('callAIGatewayPrompt empty-content retry (BUG-008)', () => {
  it('retries the same model once when content is empty, then succeeds', async () => {
    fetchMock
      .mockResolvedValueOnce(chatResponse(''))
      .mockResolvedValueOnce(chatResponse('Halo! Ada yang bisa saya bantu?'));

    const result = await callAIGatewayPrompt(baseOptions);

    expect(result).not.toBeNull();
    expect(result!.text).toBe('Halo! Ada yang bisa saya bantu?');
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('gives up after the retry and returns null when content stays empty', async () => {
    fetchMock.mockResolvedValue(chatResponse('   '));

    const result = await callAIGatewayPrompt(baseOptions);

    expect(result).toBeNull();
    // initial attempt + exactly ONE same-model retry (no infinite loop)
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('does not retry when the first response already has content', async () => {
    fetchMock.mockResolvedValue(chatResponse('Langsung jawab.'));

    const result = await callAIGatewayPrompt(baseOptions);

    expect(result!.text).toBe('Langsung jawab.');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('treats reasoning_content as content (no retry wasted)', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      headers: new Headers(),
      text: async () => JSON.stringify({
        id: 'gen-2',
        model: 'test-model',
        choices: [{
          message: { content: '', reasoning_content: 'Jawaban dari reasoning.', role: 'assistant' },
          finish_reason: 'stop',
        }],
        usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
      }),
    });

    const result = await callAIGatewayPrompt(baseOptions);

    expect(result!.text).toBe('Jawaban dari reasoning.');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
