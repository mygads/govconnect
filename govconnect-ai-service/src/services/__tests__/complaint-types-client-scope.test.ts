/**
 * P1-12 — Village scoping tests for the REAL getComplaintTypes client.
 *
 * Rule under test: villageId is REQUIRED and fail-closed. A scoped call must
 * always send the village scope (headers + query param) to the case service;
 * a call without village_id must return [] WITHOUT issuing any HTTP request.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../utils/logger', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

vi.mock('../../config/env', () => ({
  config: { caseServiceUrl: 'http://case.local', internalApiKey: 'test-key' },
}));

vi.mock('../circuit-breaker.service', () => ({
  resilientHttp: {
    get: vi.fn(),
    post: vi.fn(),
    isFallbackResponse: vi.fn(() => false),
  },
}));

vi.mock('../knowledge.service', () => ({
  getVillageProfileSummary: vi.fn(async () => null),
}));

import { getComplaintTypes } from '../case-client.service';
import { resilientHttp } from '../circuit-breaker.service';

const httpGet = vi.mocked(resilientHttp.get);

function seedTypes() {
  return [
    {
      id: 'type-a1',
      name: 'Jalan Rusak',
      category_id: 'cat-a1',
      is_urgent: false,
      require_address: true,
      send_important_contacts: false,
      important_contact_category: null,
      category: { id: 'cat-a1', name: 'Infrastruktur', village_id: 'village-a' },
    },
    {
      id: 'type-a2',
      name: 'Sampah Menumpuk',
      category_id: 'cat-a2',
      is_urgent: false,
      require_address: false,
      send_important_contacts: false,
      important_contact_category: null,
      category: { id: 'cat-a2', name: 'Kebersihan', village_id: 'village-a' },
    },
  ];
}

describe('P1-12 getComplaintTypes village scoping (case-client)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('sends a village-scoped request for village A (headers + params)', async () => {
    httpGet.mockResolvedValue({ data: { data: seedTypes() } } as any);

    const rows = await getComplaintTypes('village-a');

    expect(httpGet).toHaveBeenCalledTimes(1);
    const [url, opts] = httpGet.mock.calls[0] as [string, any];
    expect(url).toContain('/complaints/types');
    expect(opts.headers['x-admin-role']).toBe('village_admin');
    expect(opts.headers['x-village-id']).toBe('village-a');
    expect(opts.params).toEqual({ village_id: 'village-a' });
    expect(rows).toHaveLength(2);
    expect(rows.every((r) => r.category?.village_id === 'village-a')).toBe(true);
  });

  it('fail-closed: empty village_id returns [] and never issues a request', async () => {
    await expect(getComplaintTypes('')).resolves.toEqual([]);
    expect(httpGet).not.toHaveBeenCalled();
  });

  it('fail-closed: undefined village_id returns [] and never issues a request', async () => {
    await expect(getComplaintTypes(undefined as unknown as string)).resolves.toEqual([]);
    expect(httpGet).not.toHaveBeenCalled();
  });

  it('returns [] when the case service is unreachable (no leak, no throw)', async () => {
    httpGet.mockRejectedValue(new Error('ECONNREFUSED'));
    await expect(getComplaintTypes('village-a')).resolves.toEqual([]);
  });
});
