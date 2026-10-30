/**
 * Test: circuit breaker key is per-MODEL, not per-provider.
 *
 * Regression for 2026-09-30 incident: Nemotron fallback failures (35x)
 * tripped the provider-level breaker, blocking the healthy primary
 * (stealth/space-bunny-alpha) too — toolsUsed empty, totalTokens 0.
 */
import { describe, it, expect } from 'vitest';
import { buildGatewayBreakerKey } from '../ai-gateway.service';

describe('buildGatewayBreakerKey (per-model breaker)', () => {
  it('different models on same provider get different keys', () => {
    const primary = buildGatewayBreakerKey(
      'llm', 'openrouter', 'https://openrouter.ai/api/v1', 'stealth/space-bunny-alpha',
    );
    const fallback = buildGatewayBreakerKey(
      'llm', 'openrouter', 'https://openrouter.ai/api/v1', 'nvidia/nemotron-3-ultra-550b-a55b:free',
    );
    expect(primary).not.toBe(fallback);
    expect(primary).toContain('stealth/space-bunny-alpha');
    expect(fallback).toContain('nemotron');
  });

  it('same model gets same key (breaker still trips per model)', () => {
    const a = buildGatewayBreakerKey('llm', 'openrouter', 'https://openrouter.ai/api/v1', 'model-x');
    const b = buildGatewayBreakerKey('llm', 'openrouter', 'https://openrouter.ai/api/v1', 'model-x');
    expect(a).toBe(b);
  });

  it('different lanes get different keys', () => {
    const llm = buildGatewayBreakerKey('llm', 'openrouter', 'https://openrouter.ai/api/v1', 'model-x');
    const rag = buildGatewayBreakerKey('rag', 'openrouter', 'https://openrouter.ai/api/v1', 'model-x');
    expect(llm).not.toBe(rag);
  });

  it('missing/empty model falls back to "unknown" (never crashes key build)', () => {
    const k1 = buildGatewayBreakerKey('llm', 'openrouter', 'https://openrouter.ai/api/v1', undefined);
    const k2 = buildGatewayBreakerKey('llm', 'openrouter', 'https://openrouter.ai/api/v1', '');
    expect(k1).toContain(':unknown');
    expect(k2).toContain(':unknown');
  });
});
