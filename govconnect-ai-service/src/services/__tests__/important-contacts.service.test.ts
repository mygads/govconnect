/**
 * Tests for the first-class contact directory lookup.
 *
 * These cover:
 * - Classification of "directory lookup" vs active emergency report
 * - Alias / role hint detection
 * - Scoring against a synthetic Margahayu-style dataset
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../config/env', () => ({
  config: {
    dashboardServiceUrl: 'http://dashboard.local',
    internalApiKey: 'test-key',
  },
}));

vi.mock('axios', () => {
  const get = vi.fn();
  return {
    default: { get },
    get,
  };
});

import axios from 'axios';
import {
  ImportantContact,
  getImportantContacts,
  isContactDirectoryLookup,
  extractRoleHints,
  lookupImportantContacts,
  normalizeImportantContactPhone,
} from '../important-contacts.service';

const MARGAHAYU_CONTACTS: ImportantContact[] = [
  {
    id: '1',
    name: 'Damkar Bola',
    phone: '+62 811-0000-1111',
    description: 'Pos Pemadam Kebakaran Bola, layanan 24 jam.',
    category: { id: 'c1', name: 'Darurat' },
  },
  {
    id: '1b',
    name: 'Pos Damkar Bola',
    phone: '6281100001111:24@s.whatsapp.net',
    description: 'Kontak cadangan pemadam kebakaran Bola.',
    category: { id: 'c1', name: 'Darurat' },
  },
  {
    id: '2',
    name: 'Polsek Bola',
    phone: '+62 811-0000-2222',
    description: 'Kepolisian Sektor Bola.',
    category: { id: 'c2', name: 'Keamanan' },
  },
  {
    id: '3',
    name: 'Pak Andi Aswin',
    phone: '+62 811-0000-3333',
    description: 'Kepala Puskesmas Solo, pelayanan kesehatan kecamatan Solo.',
    category: { id: 'c3', name: 'Puskesmas' },
  },
  {
    id: '4',
    name: 'Pak Heru',
    phone: '+62 811-0000-4444',
    description: 'Kepala Desa Margahayu.',
    category: { id: 'c4', name: 'Pemerintah Desa' },
  },
  {
    id: '5',
    name: 'Kantor Kecamatan Solo',
    phone: '+62 811-0000-5555',
    description: 'Kantor Kecamatan Solo untuk administrasi kependudukan.',
    category: { id: 'c5', name: 'Pemerintah' },
  },
];

describe('isContactDirectoryLookup', () => {
  it('treats "ada nomor damkar?" as a lookup', () => {
    expect(isContactDirectoryLookup('ada nomor damkar?')).toBe(true);
  });

  it('treats "nomor kepala desa" as a lookup', () => {
    expect(isContactDirectoryLookup('nomor kepala desa')).toBe(true);
  });

  it('treats "ada nomor puskesmas solo?" as a lookup', () => {
    expect(isContactDirectoryLookup('ada nomor puskesmas solo?')).toBe(true);
  });

  it('does NOT treat an active kebakaran report as a lookup', () => {
    expect(isContactDirectoryLookup('rumah saya kebakaran tolong')).toBe(false);
  });

  it('does NOT treat an accident report as a lookup', () => {
    expect(isContactDirectoryLookup('ada kecelakaan di depan sekolah tolong')).toBe(false);
  });

  it('does NOT treat a detailed street address as a lookup', () => {
    expect(isContactDirectoryLookup('Jalan Kenanga No 12 RT 03/RW 05')).toBe(false);
  });

  it('returns false for empty input', () => {
    expect(isContactDirectoryLookup('')).toBe(false);
  });
});

describe('extractRoleHints', () => {
  it('detects damkar alias', () => {
    expect(extractRoleHints('ada nomor pemadam')).toContain('damkar');
  });

  it('detects kepala desa alias', () => {
    expect(extractRoleHints('nomor kades dong')).toContain('kades');
  });

  it('detects puskesmas alias', () => {
    expect(extractRoleHints('tolong nomor puskesmas terdekat')).toContain('puskesmas');
  });

  it('detects multiple roles', () => {
    const hits = extractRoleHints('nomor polisi dan damkar');
    expect(hits).toContain('polisi');
    expect(hits).toContain('damkar');
  });
});

describe('normalizeImportantContactPhone', () => {
  it('normalizes WhatsApp JID variants to canonical 628 format', () => {
    expect(normalizeImportantContactPhone('6281100001111:24@s.whatsapp.net')).toBe('6281100001111');
    expect(normalizeImportantContactPhone('0811-0000-1111')).toBe('6281100001111');
    expect(normalizeImportantContactPhone('+62 811-0000-1111')).toBe('6281100001111');
  });

  it('drops an accidental zero after country code', () => {
    expect(normalizeImportantContactPhone('62081100001111')).toBe('6281100001111');
  });
});

describe('lookupImportantContacts', () => {
  beforeEach(() => {
    (axios.get as any).mockReset();
    (axios.get as any).mockResolvedValue({ data: { data: MARGAHAYU_CONTACTS } });
  });

  it('preserves category-specific rows when the same normalized phone appears in different categories', async () => {
    (axios.get as any).mockResolvedValueOnce({
      data: {
        data: [
          {
            id: 'emergency-1',
            name: 'Damkar Bola',
            phone: '0811-0000-9999',
            description: 'Pemadam kebakaran siaga',
            category_id: 'cat-emergency',
            category: { id: 'cat-emergency', name: 'Darurat' },
          },
          {
            id: 'gov-1',
            name: 'Kantor Desa Bola',
            phone: '6281100009999:12@s.whatsapp.net',
            description: 'Nomor kantor desa',
            category_id: 'cat-government',
            category: { id: 'cat-government', name: 'Pemerintah Desa' },
          },
        ],
      },
    });

    const result = await getImportantContacts('village-margahayu');

    expect(result).toHaveLength(2);
    expect(result.map((contact) => contact.category?.id)).toEqual(['cat-emergency', 'cat-government']);
    expect(result.map((contact) => contact.phone)).toEqual(['6281100009999', '6281100009999']);
  });

  it('returns Damkar Bola for "ada nomor damkar?"', async () => {
    const result = await lookupImportantContacts('ada nomor damkar?', 'village-margahayu');
    expect(result.matches.length).toBeGreaterThan(0);
    expect(result.matches[0].contact.name.toLowerCase()).toContain('damkar');
    expect(result.role_hint).toBe('damkar');
  });

  it('returns Puskesmas Solo match for "ada nomor puskesmas solo?"', async () => {
    const result = await lookupImportantContacts('ada nomor puskesmas solo?', 'village-margahayu');
    expect(result.matches.length).toBeGreaterThan(0);
    const topHaystack = `${result.matches[0].contact.name} ${result.matches[0].contact.description}`.toLowerCase();
    expect(topHaystack).toMatch(/puskesmas|solo/);
  });

  it('falls back to health contacts for a broader medical query', async () => {
    const result = await lookupImportantContacts('nomor medis', 'village-margahayu');
    expect(result.category_hint).toBe('health');
    expect(result.matches.length).toBeGreaterThan(0);
    expect(result.matches[0].contact.description?.toLowerCase()).toContain('kesehatan');
  });

  it('returns empty matches for an unknown entity', async () => {
    const result = await lookupImportantContacts('nomor direktur bank central asia', 'village-margahayu');
    expect(result.matches.length).toBe(0);
  });

  it('returns nothing when villageId is missing', async () => {
    const result = await lookupImportantContacts('nomor damkar', undefined);
    expect(result.matches.length).toBe(0);
    expect(result.total_candidates).toBe(0);
  });

  it('returns Kepala Desa for "nomor kepala desa"', async () => {
    const result = await lookupImportantContacts('nomor kepala desa', 'village-margahayu');
    expect(result.matches.length).toBeGreaterThan(0);
    const top = result.matches[0];
    expect(top.contact.description?.toLowerCase()).toContain('kepala desa');
  });

  it('deduplicates contacts that share the same normalized phone number', async () => {
    const result = await lookupImportantContacts('nomor damkar', 'village-margahayu');
    const phones = result.matches.map((match) => match.contact.phone);
    expect(phones.filter((phone) => phone === '6281100001111')).toHaveLength(1);
    expect(new Set(phones).size).toBe(phones.length);
  });
});
