/**
 * Tests for the pre-agent state router shortcuts:
 * - Service listing shortcut (deterministic catalog listing)
 * - Contact directory shortcut (grounded contact lookup)
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('axios', () => {
  const get = vi.fn();
  const post = vi.fn();
  return {
    default: { get, post },
    get,
    post,
  };
});

// Mock getServiceCatalog so we don't hit the network.
vi.mock('../case-client.service', () => ({
  getServiceCatalog: vi.fn(),
  getUserHistory: vi.fn().mockResolvedValue({ total: 0, combined: [], services: [] }),
  cancelComplaint: vi.fn(),
  cancelServiceRequest: vi.fn(),
}));

import {
  isConfidentContactLookupResult,
  isServiceListingQuery,
  shouldAttachEmergencyShortcutContacts,
  tryHandleServiceListingShortcut,
} from '../pre-agent-state-router.service';
import { getServiceCatalog } from '../case-client.service';

describe('isServiceListingQuery', () => {
  it('matches "layanan apa aja"', () => {
    expect(isServiceListingQuery('layanan apa aja yg bisa dilakukan disini?')).toBe(true);
  });

  it('matches "apa aja layanan desa"', () => {
    expect(isServiceListingQuery('apa aja layanan desa')).toBe(true);
  });

  it('matches "list layanan"', () => {
    expect(isServiceListingQuery('list layanan')).toBe(true);
  });

  it('matches "daftar layanan"', () => {
    expect(isServiceListingQuery('daftar layanan')).toBe(true);
  });

  it('matches "pelayanan desa apa aja"', () => {
    expect(isServiceListingQuery('pelayanan desa apa aja?')).toBe(true);
  });

  it('matches "bisa urus apa aja di sini"', () => {
    expect(isServiceListingQuery('bisa urus apa aja di sini?')).toBe(true);
  });

  it('does NOT match a specific service request', () => {
    expect(isServiceListingQuery('saya mau urus ktp')).toBe(false);
  });

  it('does NOT match a complaint', () => {
    expect(isServiceListingQuery('lapor jalan rusak')).toBe(false);
  });
});

describe('isConfidentContactLookupResult', () => {
  it('accepts a single high-score match', () => {
    expect(isConfidentContactLookupResult({
      matches: [{ score: 0.82 }],
    })).toBe(true);
  });

  it('rejects close multi-match results so they can be clarified by the agent', () => {
    expect(isConfidentContactLookupResult({
      matches: [{ score: 0.83 }, { score: 0.75 }],
    })).toBe(false);
  });
});

describe('shouldAttachEmergencyShortcutContacts', () => {
  it('rejects category-only fallback matches for generic emergency messages', () => {
    expect(shouldAttachEmergencyShortcutContacts({
      matches: [{ score: 0.3, matchedBy: ['category_fallback'] } as any],
      total_candidates: 3,
      category_hint: 'emergency',
      role_hint: null,
    })).toBe(false);
  });

  it('accepts grounded emergency matches without a role hint', () => {
    expect(shouldAttachEmergencyShortcutContacts({
      matches: [{ score: 0.7, matchedBy: ['alias_description', 'token_overlap'] } as any],
      total_candidates: 3,
      category_hint: 'emergency',
      role_hint: null,
    })).toBe(true);
  });

  it('requires confidence when a specific emergency role was inferred', () => {
    expect(shouldAttachEmergencyShortcutContacts({
      matches: [
        { score: 0.81, matchedBy: ['role_match'] } as any,
        { score: 0.73, matchedBy: ['role_match'] } as any,
      ],
      total_candidates: 3,
      category_hint: 'emergency',
      role_hint: 'damkar',
    })).toBe(false);
  });
});

describe('tryHandleServiceListingShortcut', () => {
  beforeEach(() => {
    (getServiceCatalog as any).mockReset();
  });

  it('returns a deterministic list when catalog has services', async () => {
    (getServiceCatalog as any).mockResolvedValue([
      { slug: 'ktp-baru', name: 'Perekaman KTP', is_active: true, category: { name: 'Kependudukan' } },
      { slug: 'surat-domisili', name: 'Surat Keterangan Domisili', is_active: true, category: { name: 'Surat' } },
      { slug: 'surat-usaha', name: 'Surat Keterangan Usaha', is_active: true, category: { name: 'Surat' } },
      { slug: 'surat-keluarga', name: 'Kartu Keluarga', is_active: false, category: { name: 'Kependudukan' } }, // inactive
    ]);

    const result = await tryHandleServiceListingShortcut({
      message: 'layanan apa aja yg bisa dilakukan disini?',
      villageId: 'village-margahayu',
      traceId: 'trace-1',
      startTime: Date.now(),
    });

    expect(result).not.toBeNull();
    expect(result?.intent).toBe('SERVICE_INFO');
    expect(result?.response).toMatch(/Perekaman KTP|Surat Keterangan Domisili/);
    expect(result?.metadata.guardrail?.type).toBe('service_listing_shortcut');
    // Inactive service should not appear
    expect(result?.response.includes('Kartu Keluarga')).toBe(false);
  });

  it('returns null for non-listing messages', async () => {
    const result = await tryHandleServiceListingShortcut({
      message: 'saya mau urus ktp',
      villageId: 'village-margahayu',
      traceId: 'trace-2',
      startTime: Date.now(),
    });
    expect(result).toBeNull();
  });

  it('returns null when villageId is missing', async () => {
    const result = await tryHandleServiceListingShortcut({
      message: 'layanan apa aja',
      villageId: undefined,
      traceId: 'trace-3',
      startTime: Date.now(),
    });
    expect(result).toBeNull();
  });

  it('returns a gentle message when catalog is empty', async () => {
    (getServiceCatalog as any).mockResolvedValue([]);

    const result = await tryHandleServiceListingShortcut({
      message: 'layanan apa aja',
      villageId: 'village-empty',
      traceId: 'trace-4',
      startTime: Date.now(),
    });

    expect(result).not.toBeNull();
    expect(result?.response).toMatch(/belum ada layanan/i);
  });
});
