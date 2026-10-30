/**
 * P1-4 unit tests: tool dedup (exact / normalized / near-duplicate) +
 * parallel execution (bounded pool, wave-based dependencies, failure
 * isolation, sequential mutations).
 *
 * The service layer is mocked; what we prove here is the executor's
 * orchestration: how many real executions happen, in what order, and how
 * results map back to each caller's tool_call_id.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../utils/logger', () => ({
  default: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

vi.mock('../important-contacts.service', () => ({
  getImportantContacts: vi.fn(async () => []),
  lookupImportantContacts: vi.fn(async () => ({
    matches: [],
    total_candidates: 0,
    category_hint: null,
    role_hint: null,
  })),
  isConfidentContactLookupResult: () => false,
  shouldAttachEmergencyLookupContacts: () => false,
}));

vi.mock('../case-client.service', () => ({
  cancelComplaint: vi.fn(async () => null),
  cancelServiceRequest: vi.fn(async () => null),
  createComplaint: vi.fn(async () => 'LAP-TEST-001'),
  getComplaintStatusWithOwnership: vi.fn(async () => null),
  getComplaintTypes: vi.fn(async () => [
    {
      id: 'cat-1',
      name: 'Jalan Rusak',
      slug: 'jalan-rusak',
      category_id: 'catg-1',
      is_urgent: false,
      require_address: false,
      send_important_contacts: false,
    },
  ]),
  requestServiceRequestEditToken: vi.fn(async () => null),
  buildServiceInfoContext: vi.fn(async () => null),
  getServiceCatalog: vi.fn(async () => []),
  getServiceRequestStatusWithOwnership: vi.fn(async () => null),
  getUserHistory: vi.fn(async () => []),
  updateComplaintByUser: vi.fn(async () => null),
}));

vi.mock('../hybrid-memory.service', () => ({
  rememberMemoryEvent: vi.fn(async () => {}),
  searchUserMemories: vi.fn(async () => []),
}));

vi.mock('../knowledge.service', () => ({
  searchDocuments: vi.fn(async () => []),
  searchKnowledge: vi.fn(async () => []),
  getVillageProfileSummary: vi.fn(async () => null),
}));

vi.mock('../runtime-observability.service', () => ({
  recordMemoryTrace: vi.fn(async () => {}),
}));

vi.mock('../vector-db.service', () => ({
  searchKnowledgeByKeywordsDirect: vi.fn(async () => []),
}));

vi.mock('../service-handler', () => ({
  resolveServiceSlugFromSearch: vi.fn(async () => null),
}));

vi.mock('../ump-utils', () => ({
  resolveVillageSlugForPublicForm: vi.fn(async () => 'desa-test'),
}));

vi.mock('../ump-formatters', () => ({
  buildCancelErrorResponse: vi.fn(() => 'cancel error'),
  buildCancelSuccessResponse: vi.fn(() => 'cancel success'),
  buildHistoryResponse: vi.fn(() => 'history'),
  buildNaturalServiceStatusResponse: vi.fn(() => 'service status'),
  buildNaturalStatusResponse: vi.fn(() => 'complaint status'),
  buildEditServiceFormUrl: vi.fn(() => 'https://example.test/edit'),
  buildPublicServiceFormUrl: vi.fn(() => 'https://example.test/form'),
  buildImportantContactsMessage: vi.fn(() => ''),
  getPublicFormBaseUrl: vi.fn(() => 'https://example.test'),
  getStatusLabel: vi.fn(() => 'OPEN'),
  toVCardContacts: vi.fn((contacts: any[]) => contacts.map((c) => ({ name: c.name, phone: c.phone }))),
}));

vi.mock('../ump-state', () => ({
  clearPendingServiceClarification: vi.fn(),
  setActiveServiceInfo: vi.fn(),
  setPendingAddressRequest: vi.fn(),
  setPendingCancelConfirmation: vi.fn(),
  setPendingServiceClarification: vi.fn(),
  setPendingServiceFormOffer: vi.fn(),
}));

vi.mock('../user-profile.service', () => ({
  getAutoFillSuggestionsWithFallback: vi.fn(async () => ({})),
  recordComplaintCreated: vi.fn(),
  recordServiceUsage: vi.fn(),
  saveDefaultAddress: vi.fn(),
  updateProfile: vi.fn(),
}));

vi.mock('../channel-client.service', () => ({
  updateConversationUserProfile: vi.fn(async () => true),
}));

import { getServiceCatalog } from '../case-client.service';
import { searchKnowledge } from '../knowledge.service';
import { getAutoFillSuggestionsWithFallback } from '../user-profile.service';
import {
  executeToolCall,
  executeToolCalls,
  buildToolDedupKey,
  canonicalizeServiceName,
  runWithConcurrencyLimit,
  type ExecutedToolCall,
} from '../agent/tool-executor';

const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));

const baseCtx = {
  userId: '6281234567890',
  villageId: 'village-1',
  channel: 'webchat' as const,
  sideEffectMode: 'production' as const,
};

function freshDedupMap() {
  return new Map<string, Promise<ExecutedToolCall>>();
}

/** True when none of the [start,end] spans overlap. */
function spansAreSequential(spans: Array<{ start: number; end: number }>): boolean {
  const sorted = [...spans].sort((a, b) => a.start - b.start);
  for (let i = 1; i < sorted.length; i += 1) {
    if (sorted[i].start < sorted[i - 1].end) return false;
  }
  return true;
}

describe('P1-4 buildToolDedupKey normalization', () => {
  it('ignores key order', () => {
    expect(buildToolDedupKey('get_service_info', { a: '1', b: '2' }))
      .toBe(buildToolDedupKey('get_service_info', { b: '2', a: '1' }));
  });

  it('normalizes case / whitespace / empty values', () => {
    const k1 = buildToolDedupKey('get_service_info', { service_name: 'KTP' });
    const k2 = buildToolDedupKey('get_service_info', { service_name: '  ktp ' });
    const k3 = buildToolDedupKey('get_service_info', { service_name: 'KTP', extra: '' });
    const k4 = buildToolDedupKey('get_service_info', { service_name: 'KTP', extra: null });
    expect(k2).toBe(k1);
    expect(k3).toBe(k1);
    expect(k4).toBe(k1);
  });

  it('keeps different tools and genuinely different args apart', () => {
    const k1 = buildToolDedupKey('get_service_info', { service_name: 'KTP' });
    const k2 = buildToolDedupKey('get_service_info', { service_name: 'KK' });
    const k3 = buildToolDedupKey('search_knowledge', { query: 'ktp' });
    expect(k2).not.toBe(k1);
    expect(k3).not.toBe(k1);
  });
});

describe('P1-4 canonicalizeServiceName', () => {
  it.each([
    ['KTP', 'ktp'],
    ['pendaftaran KTP', 'ktp'],
    ['syarat bikin KTP', 'ktp'],
    ['  Cara Pembuatan  KTP ', 'ktp'],
    ['Kartu Tanda Penduduk', 'ktp'],
    ['KTP-el', 'ktp'],
    ['pengurusan kartu keluarga', 'kk'],
    ['surat domisili', 'surat domisili'],
  ])('canonicalizes %p -> %p', (raw, expected) => {
    expect(canonicalizeServiceName(raw)).toBe(expected);
  });

  it('honest limit: uncovered paraphrases are NOT collapsed', () => {
    // Documented miss — "surat domisili" vs "keterangan domisili" still
    // execute twice. The alias map is deliberately tiny.
    expect(canonicalizeServiceName('surat domisili'))
      .not.toBe(canonicalizeServiceName('keterangan domisili'));
  });
});

describe('P1-4 per-turn dedup via executeToolCall', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getServiceCatalog).mockImplementation(async () => {
      await delay(120);
      return [];
    });
    vi.mocked(searchKnowledge).mockResolvedValue([] as any);
  });

  it('(a) two identical calls launched concurrently execute once', async () => {
    const dedup = freshDedupMap();
    const ctx = { ...baseCtx, executedTools: dedup };
    const [r1, r2] = await Promise.all([
      executeToolCall('get_service_info', { service_name: 'KTP' }, ctx),
      executeToolCall('get_service_info', { service_name: 'KTP' }, ctx),
    ]);
    expect(vi.mocked(getServiceCatalog)).toHaveBeenCalledTimes(1);
    expect(r1.content).toBe(r2.content);
    expect(r1.result.success).toBe(true);
    expect(r2.result.success).toBe(true);
  });

  it('(a2) normalized duplicates (case/whitespace) execute once', async () => {
    const dedup = freshDedupMap();
    const ctx = { ...baseCtx, executedTools: dedup };
    const results = await executeToolCalls(
      [
        { id: 'call_1', tool: 'get_service_info', args: { service_name: 'KTP' } },
        { id: 'call_2', tool: 'get_service_info', args: { service_name: '  ktp  ' } },
      ],
      ctx,
    );
    expect(vi.mocked(getServiceCatalog)).toHaveBeenCalledTimes(1);
    expect(results).toHaveLength(2);
    expect(results[0].call.id).toBe('call_1');
    expect(results[1].call.id).toBe('call_2');
    expect(results[1].deduped).toBe(true);
    expect(results[0].executed.content).toBe(results[1].executed.content);
  });

  it('(b) near-duplicates ("KTP" vs "pendaftaran KTP") execute once', async () => {
    const dedup = freshDedupMap();
    const ctx = { ...baseCtx, executedTools: dedup };
    const results = await executeToolCalls(
      [
        { id: 'call_1', tool: 'get_service_info', args: { service_name: 'KTP' } },
        { id: 'call_2', tool: 'get_service_info', args: { service_name: 'pendaftaran KTP' } },
      ],
      ctx,
    );
    expect(vi.mocked(getServiceCatalog)).toHaveBeenCalledTimes(1);
    expect(results[1].deduped).toBe(true);
    expect(results[0].executed.content).toBe(results[1].executed.content);
  });

  it('(b-limit) uncovered paraphrases still execute twice (documented)', async () => {
    const dedup = freshDedupMap();
    const ctx = { ...baseCtx, executedTools: dedup };
    const results = await executeToolCalls(
      [
        { id: 'call_1', tool: 'get_service_info', args: { service_name: 'surat domisili' } },
        { id: 'call_2', tool: 'get_service_info', args: { service_name: 'keterangan domisili' } },
      ],
      ctx,
    );
    expect(vi.mocked(getServiceCatalog)).toHaveBeenCalledTimes(2);
    expect(results[1].deduped).toBe(false);
  });
});

describe('P1-4 parallel execution via executeToolCalls', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(searchKnowledge).mockResolvedValue([] as any);
  });

  it('(c) 3 independent tools finish in ~1x time, not 3x', async () => {
    const spans: Array<{ start: number; end: number }> = [];
    vi.mocked(getServiceCatalog).mockImplementation(async () => {
      const start = Date.now();
      await delay(200);
      spans.push({ start, end: Date.now() });
      return [];
    });
    const wallStart = Date.now();
    const results = await executeToolCalls(
      [
        { id: 'call_1', tool: 'get_service_info', args: { service_name: 'KTP' } },
        { id: 'call_2', tool: 'get_service_info', args: { service_name: 'KK' } },
        { id: 'call_3', tool: 'get_service_info', args: { service_name: 'domisili' } },
      ],
      { ...baseCtx, executedTools: freshDedupMap() },
      { concurrency: 5 },
    );
    const wallMs = Date.now() - wallStart;
    expect(vi.mocked(getServiceCatalog)).toHaveBeenCalledTimes(3);
    expect(results.every((r) => r.executed.result.success)).toBe(true);
    // Parallel: ~200ms. Sequential would be >= 600ms. Generous bounds for CI noise.
    expect(wallMs).toBeGreaterThanOrEqual(150);
    expect(wallMs).toBeLessThan(500);
    // Sanity: the three executions actually overlapped.
    expect(spansAreSequential(spans)).toBe(false);
  });

  it('(d) dependent tools stay sequential and map to the right call ids', async () => {
    const spans: Array<{ start: number; end: number }> = [];
    vi.mocked(getServiceCatalog).mockImplementation(async () => {
      const start = Date.now();
      await delay(150);
      spans.push({ start, end: Date.now() });
      return [];
    });
    const results = await executeToolCalls(
      [
        { id: 'call_a', tool: 'get_service_info', args: { service_name: 'KTP' } },
        // B references A's call id -> must run after A.
        { id: 'call_b', tool: 'get_service_info', args: { service_name: 'domisili', note: 'after call_a' } },
        // C uses a {{placeholder}} referencing B -> must run after B.
        { id: 'call_c', tool: 'get_service_info', args: { service_name: 'kk', ref: '{{call_b.data}}' } },
      ],
      { ...baseCtx, executedTools: freshDedupMap() },
      { concurrency: 5 },
    );
    expect(vi.mocked(getServiceCatalog)).toHaveBeenCalledTimes(3);
    // Results come back in input order, each mapped to its own call id.
    expect(results.map((r) => r.call.id)).toEqual(['call_a', 'call_b', 'call_c']);
    expect(results.every((r) => r.executed.result.success)).toBe(true);
    // No overlap: A -> B -> C ran in waves.
    expect(spansAreSequential(spans)).toBe(true);
  });

  it('(e) one failing tool does not fail its independent siblings', async () => {
    vi.mocked(getServiceCatalog).mockImplementation(async () => {
      await delay(80);
      return [];
    });
    vi.mocked(searchKnowledge).mockImplementation(async (query: string) => {
      if (query.includes('boom')) throw new Error('simulated RAG outage');
      return [] as any;
    });
    const results = await executeToolCalls(
      [
        { id: 'call_1', tool: 'search_knowledge', args: { query: 'boom query' } },
        { id: 'call_2', tool: 'get_service_info', args: { service_name: 'KTP' } },
        { id: 'call_3', tool: 'get_service_info', args: { service_name: 'KK' } },
      ],
      { ...baseCtx, executedTools: freshDedupMap() },
      { concurrency: 5 },
    );
    expect(results).toHaveLength(3);
    // The failing tool gets its own user-facing failure result...
    expect(results[0].call.id).toBe('call_1');
    expect(results[0].executed.result.success).toBe(false);
    expect(results[0].executed.result.error).toBe('retrieval_tool_failed:search_knowledge');
    // ...while the independent siblings still succeed.
    expect(results[1].executed.result.success).toBe(true);
    expect(results[2].executed.result.success).toBe(true);
  });

  it('mutations always run sequentially even in a batch', async () => {
    const spans: Array<{ start: number; end: number }> = [];
    vi.mocked(getAutoFillSuggestionsWithFallback).mockImplementation(async () => {
      const start = Date.now();
      await delay(150);
      spans.push({ start, end: Date.now() });
      return {};
    });
    const evalCtx = { ...baseCtx, isEvaluation: true, executedTools: freshDedupMap() };
    const results = await executeToolCalls(
      [
        {
          id: 'call_m1', tool: 'create_complaint',
          args: { kategori: 'Jalan Rusak', deskripsi: 'Jalan berlubang parah di RT 01', alamat: 'Jl. Mawar 1' },
        },
        {
          id: 'call_m2', tool: 'create_complaint',
          args: { kategori: 'Jalan Rusak', deskripsi: 'Lampu jalan mati total semalaman', alamat: 'Jl. Mawar 2' },
        },
      ],
      evalCtx,
      { concurrency: 5 },
    );
    expect(results.map((r) => r.call.id)).toEqual(['call_m1', 'call_m2']);
    expect(results.every((r) => r.executed.result.success)).toBe(true);
    expect(spans).toHaveLength(2);
    expect(spansAreSequential(spans)).toBe(true);
  });

  it('runWithConcurrencyLimit never exceeds the limit and keeps order', async () => {
    let inFlight = 0;
    let maxInFlight = 0;
    const tasks = Array.from({ length: 10 }, (_, i) => async () => {
      inFlight += 1;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await delay(30);
      inFlight -= 1;
      return i * 2;
    });
    const out = await runWithConcurrencyLimit(tasks, 3);
    expect(out).toEqual(Array.from({ length: 10 }, (_, i) => i * 2));
    expect(maxInFlight).toBeLessThanOrEqual(3);
    expect(maxInFlight).toBeGreaterThan(1);
  });
});
