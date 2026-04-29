import { describe, expect, it } from 'vitest';
import { __test_only__ as adminConfigTest } from '../ai-admin-config.service';
import { __test_only__ as gatewayTest } from '../ai-gateway.service';

describe('AI gateway provider headers', () => {
  it('strips auth-like headers from admin default headers', () => {
    const headers = adminConfigTest.sanitizeHeaders({
      Authorization: 'Bearer hack',
      'proxy-authorization': 'Bearer proxy',
      'x-api-key': 'hack-key',
      'x-goog-api-key': 'goog-key',
      'api-key': 'api-key',
      apikey: 'apikey',
      'x-auth-token': 'token',
      'X-Tenant': 'desa-1',
      empty: '',
      numeric: 123,
    });

    expect(headers).toEqual({ 'X-Tenant': 'desa-1' });
  });

  it('uses the decrypted runtime API key even if legacy data contains Authorization', () => {
    const headers = gatewayTest.buildHeaders({
      enabled: true,
      provider: 'openrouter',
      baseUrl: 'https://example.test/v1',
      apiKeys: [],
      defaultHeaders: {
        Authorization: 'Bearer stored-hack',
        'proxy-authorization': 'Bearer proxy-hack',
        'x-api-key': 'stored-api-key',
        'X-Goog-Api-Key': 'stored-google-key',
        apikey: 'stored-apikey',
        'HTTP-Referer': 'https://stored.example',
        'X-Title': 'Stored title',
        'X-Tenant': 'desa-1',
      },
      openRouterSiteUrl: 'https://official.example',
      openRouterAppName: 'Official app',
      openRouterProviderOrder: [],
      openRouterAllowFallbacks: true,
      openRouterRequireParameters: false,
      openRouterZDROnly: false,
      model: 'test-model',
      timeoutMs: 1000,
      chatCompletionsPath: '/chat/completions',
    }, 'decrypted-key');

    expect(headers.Authorization).toBe('Bearer decrypted-key');
    expect(headers['proxy-authorization']).toBeUndefined();
    expect(headers['x-api-key']).toBeUndefined();
    expect(headers['X-Goog-Api-Key']).toBeUndefined();
    expect(headers.apikey).toBeUndefined();
    expect(headers['X-Tenant']).toBe('desa-1');
    expect(headers['HTTP-Referer']).toBe('https://official.example');
    expect(headers['X-Title']).toBe('Official app');
  });
});
