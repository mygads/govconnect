import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../config/env', () => ({
  config: {
    dashboardServiceUrl: 'http://dashboard.local',
    internalApiKey: 'test-key',
  },
}));

vi.mock('../important-contacts.service', () => ({
  getImportantContacts: vi.fn(async () => [
    { id: 'c1', name: 'Damkar Desa', phone: '0271-555-111' },
    { id: 'c2', name: 'Puskesmas Utara', phone: '0271555222' },
  ]),
}));

vi.mock('../knowledge.service', () => ({
  getVillageProfileSummary: vi.fn(async () => ({
    name: 'Desa Demo',
    address: 'Jl. Merdeka No. 10, Desa Demo',
    operating_hours: 'Senin-Jumat 08:00-15:00',
  })),
}));

vi.mock('../case-client.service', () => ({
  getServiceCatalog: vi.fn(async () => []),
}));

import { reconcile } from '../db-rag-reconciler.service';
import type { ProcessMessageResult } from '../ump-types';

function baseResult(overrides: Partial<ProcessMessageResult>): ProcessMessageResult {
  return {
    success: true,
    response: '',
    intent: 'KNOWLEDGE_QUERY',
    ...overrides,
    metadata: {
      processingTimeMs: 1,
      hasKnowledge: false,
      agentMode: 'single_orchestrator',
      traceId: 'trace-test',
      toolsUsed: [],
      ...(overrides.metadata || {}),
    },
  } as ProcessMessageResult;
}

describe('db-rag-reconciler', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('short-circuits when villageId missing', async () => {
    const result = baseResult({ response: 'Nomor damkar 0271-999-888.' });
    const decision = await reconcile({
      result,
      toolsUsed: ['get_important_contact'],
    });
    expect(decision.ok).toBe(true);
    expect(decision.rewritten).toBe(false);
  });

  it('accepts phone number that matches DB', async () => {
    const result = baseResult({ response: 'Damkar Desa: 0271-555-111' });
    const decision = await reconcile({
      villageId: 'v1',
      result,
      toolsUsed: ['get_important_contact'],
    });
    expect(decision.mismatches).toHaveLength(0);
    expect(decision.ok).toBe(true);
  });

  it('flags phone number that is NOT in DB even though tool was called', async () => {
    const result = baseResult({
      response: 'Damkar desa nomor 0271-888-222 ya pak.',
    });
    const decision = await reconcile({
      villageId: 'v1',
      result,
      toolsUsed: ['get_important_contact'],
    });
    expect(decision.ok).toBe(false);
    expect(decision.mismatches[0].kind).toBe('phone_not_in_db');
    expect(decision.replacement).toBeDefined();
  });

  it('does not flag phones when no contact tool was used (answer-policy handles that earlier)', async () => {
    const result = baseResult({
      response: 'Coba hubungi 0271-888-222.',
    });
    const decision = await reconcile({
      villageId: 'v1',
      result,
      toolsUsed: ['search_knowledge'],
    });
    // Reconciler is defence-in-depth. Ungrounded phone is caught by
    // answer-policy verifier upstream; reconciler stays silent here.
    expect(decision.ok).toBe(true);
  });

  it('flags operating hour mismatch against DB', async () => {
    const result = baseResult({
      response: 'Jam buka kantor 09:00 sampai 16:00.',
    });
    const decision = await reconcile({
      villageId: 'v1',
      result,
      toolsUsed: ['get_village_profile'],
    });
    expect(decision.ok).toBe(false);
    expect(decision.mismatches.some((m) => m.kind === 'operating_hour_mismatch')).toBe(true);
  });

  it('accepts operating hours that match DB (canonical colon form)', async () => {
    const result = baseResult({
      response: 'Jam buka Senin-Jumat 08:00-15:00.',
    });
    const decision = await reconcile({
      villageId: 'v1',
      result,
      toolsUsed: ['get_village_profile'],
    });
    expect(decision.ok).toBe(true);
  });

  it('skips reconciliation for empty response', async () => {
    const result = baseResult({ response: '' });
    const decision = await reconcile({
      villageId: 'v1',
      result,
      toolsUsed: ['get_village_profile'],
    });
    expect(decision.ok).toBe(true);
    expect(decision.rewritten).toBe(false);
  });

  it('normalizes 62-prefix phone to 0-prefix when comparing', async () => {
    const result = baseResult({ response: 'Damkar: +62 271-555-111' });
    const decision = await reconcile({
      villageId: 'v1',
      result,
      toolsUsed: ['get_important_contact'],
    });
    expect(decision.ok).toBe(true);
  });
});
