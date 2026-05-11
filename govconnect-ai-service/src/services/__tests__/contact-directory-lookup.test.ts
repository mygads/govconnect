/**
 * Contact directory lookup smoke tests.
 *
 * These verify the two core rules from the production audit:
 *   1. "ada nomor X" / "nomor X" / "kontak X" is a directory lookup, not emergency.
 *   2. An ordinal reply like "nomor 2" is NOT a directory lookup (it belongs to a pending flow).
 */

import { describe, expect, it, vi } from 'vitest';
import {
  extractRoleHints,
  isContactDirectoryLookup,
  lookupImportantContacts,
  type ImportantContact,
} from '../important-contacts.service';

vi.mock('../../config/env', () => ({
  config: {
    dashboardServiceUrl: 'http://dashboard.local',
    internalApiKey: 'test-key',
  },
}));

vi.mock('axios', () => {
  const defaultContacts: ImportantContact[] = [
    {
      id: 'c1',
      name: 'Damkar Bola',
      phone: '0200-123456',
      description: 'Pemadam kebakaran Kecamatan Bola',
      category: { id: 'cat-emergency', name: 'Darurat' },
    },
    {
      id: 'c2',
      name: 'Pak Andi Aswin',
      phone: '0811-222-333',
      description: 'Puskesmas Solo, dokter jaga',
      category: { id: 'cat-health', name: 'Kesehatan' },
    },
    {
      id: 'c3',
      name: 'Polsek Bola',
      phone: '0200-654321',
      description: 'Kepolisian sektor Bola',
      category: { id: 'cat-emergency', name: 'Darurat' },
    },
    {
      id: 'c4',
      name: 'Kepala Desa Margahayu',
      phone: '0813-111-222',
      description: 'Kepala desa aktif',
      category: { id: 'cat-gov', name: 'Pemerintahan Desa' },
    },
  ];

  return {
    default: {
      get: vi.fn(async () => ({ data: { data: defaultContacts } })),
    },
  };
});

describe('isContactDirectoryLookup', () => {
  it('recognises "ada nomor damkar?" as directory lookup', () => {
    expect(isContactDirectoryLookup('ada nomor damkar?')).toBe(true);
  });

  it('recognises "nomor kepala desa?" as directory lookup', () => {
    expect(isContactDirectoryLookup('nomor kepala desa?')).toBe(true);
  });

  it('recognises "ada nomor puskesmas solo?" as directory lookup', () => {
    expect(isContactDirectoryLookup('ada nomor puskesmas solo?')).toBe(true);
  });

  it('recognises "kontak polsek" as directory lookup', () => {
    expect(isContactDirectoryLookup('kontak polsek')).toBe(true);
  });

  it('does NOT treat "nomor 2" (ordinal reply) as a directory lookup', () => {
    expect(isContactDirectoryLookup('nomor 2')).toBe(false);
  });

  it('does NOT treat short ordinal replies as directory lookups', () => {
    expect(isContactDirectoryLookup('opsi 1')).toBe(false);
    expect(isContactDirectoryLookup('yang pertama')).toBe(false);
  });

  it('does NOT treat active emergency reports as directory lookups', () => {
    expect(isContactDirectoryLookup('tolong rumah saya kebakaran')).toBe(false);
    expect(isContactDirectoryLookup('ada kecelakaan di depan sekolah')).toBe(false);
  });

  it('does NOT treat plain infrastructure complaints as directory lookups', () => {
    expect(isContactDirectoryLookup('jalan rusak parah')).toBe(false);
  });

  it('does NOT treat a detailed street address as a directory lookup', () => {
    expect(isContactDirectoryLookup('Jalan Kenanga No 12 RT 03/RW 05')).toBe(false);
  });
});

describe('extractRoleHints', () => {
  it('extracts damkar from "ada nomor damkar"', () => {
    expect(extractRoleHints('ada nomor damkar')).toContain('damkar');
  });

  it('extracts puskesmas from "puskesmas solo"', () => {
    expect(extractRoleHints('nomor puskesmas solo')).toContain('puskesmas');
  });

  it('extracts kades from "kepala desa"', () => {
    expect(extractRoleHints('nomor kepala desa')).toContain('kades');
  });

  it('extracts polisi from "polsek"', () => {
    expect(extractRoleHints('kontak polsek')).toContain('polisi');
  });
});

describe('lookupImportantContacts', () => {
  it('returns Damkar when asked for "nomor damkar"', async () => {
    const result = await lookupImportantContacts('ada nomor damkar', 'village-1');
    expect(result.role_hint).toBe('damkar');
    expect(result.matches.length).toBeGreaterThan(0);
    expect(result.matches[0].contact.name).toMatch(/damkar/i);
  });

  it('returns Puskesmas when asked for "nomor puskesmas solo"', async () => {
    const result = await lookupImportantContacts('ada nomor puskesmas solo', 'village-1');
    expect(result.role_hint).toBe('puskesmas');
    expect(result.matches.length).toBeGreaterThan(0);
    expect(result.matches[0].contact.description || '').toMatch(/puskesmas/i);
  });

  it('returns Kepala Desa when asked for "nomor kepala desa"', async () => {
    const result = await lookupImportantContacts('nomor kepala desa', 'village-1');
    expect(result.role_hint).toBe('kades');
    expect(result.matches.length).toBeGreaterThan(0);
    expect(result.matches[0].contact.name).toMatch(/kepala desa/i);
  });

  it('returns Polsek when asked for "kontak polsek"', async () => {
    const result = await lookupImportantContacts('kontak polsek', 'village-1');
    expect(result.role_hint).toBe('polisi');
    expect(result.matches.length).toBeGreaterThan(0);
    expect(result.matches[0].contact.name).toMatch(/polsek/i);
  });

  it('returns an empty result for missing village id', async () => {
    const result = await lookupImportantContacts('nomor damkar', undefined);
    expect(result.matches).toEqual([]);
    expect(result.total_candidates).toBe(0);
  });

  it('returns an empty result for an empty query', async () => {
    const result = await lookupImportantContacts('', 'village-1');
    expect(result.matches).toEqual([]);
  });

  it('falls back to health contacts for a broader medical query', async () => {
    const result = await lookupImportantContacts('kontak medis', 'village-1');
    expect(result.category_hint).toBe('health');
    expect(result.matches.length).toBeGreaterThan(0);
    expect(result.matches[0].contact.description || '').toMatch(/dokter|puskesmas/i);
  });

  it('returns empty matches when query has no known role/alias', async () => {
    const result = await lookupImportantContacts('sesuatu yang sangat tidak dikenal', 'village-1');
    expect(result.matches).toEqual([]);
  });
});
