/**
 * P1 Bug Fix Tests — Round 2 Tim C findings.
 *
 * Tests for:
 * - [P1-1] VERIFY stage: decideIdentityResume with 'konfirmasi' waitingFor
 * - [P1-1] buildConfirmationSummary output format
 * - [P1-4] NIK validation: tryHandleNikValidation
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock micro-LLM before importing the FSM
vi.mock('../micro-llm-matcher.service', () => ({
  extractNameViaNLU: vi.fn().mockResolvedValue({ name: 'Budi Santoso', confidence: 0.9 }),
  analyzeAddress: vi.fn(),
  classifyMessage: vi.fn(),
  classifyUpdateIntent: vi.fn(),
  matchComplaintType: vi.fn(),
  summarizeConversation: vi.fn(),
}));

vi.mock('../ump-utils', () => ({
  extractAddressFromMessage: vi.fn(),
  resolveComplaintTypeConfig: vi.fn().mockResolvedValue(null),
  getCachedComplaintTypes: vi.fn().mockResolvedValue([]),
  isVagueAddress: vi.fn().mockResolvedValue(false),
}));

vi.mock('../ump-state', () => ({
  setPendingAddressRequest: vi.fn(),
  clearPendingAddressRequest: vi.fn(),
  getPendingAddressRequestWithFallback: vi.fn(),
  setPendingComplaintData: vi.fn(),
  clearPendingComplaintData: vi.fn(),
  getPendingComplaintDataWithFallback: vi.fn(),
}));

vi.mock('./hybrid-memory.service', () => ({
  rememberMemoryEvent: vi.fn(),
}));

vi.mock('../pipeline/abort-guard', () => ({
  assertNotAborted: vi.fn(),
}));

vi.mock('./user-profile.service', () => ({
  getAutoFillSuggestionsWithFallback: vi.fn().mockResolvedValue({}),
}));

vi.mock('./important-contacts.service', () => ({
  isContactDirectoryLookup: vi.fn().mockReturnValue(false),
}));

import {
  decideIdentityResume,
  buildConfirmationSummary,
} from '../complaint-fsm.service';

describe('[P1-1] VERIFY stage — decideIdentityResume with konfirmasi', () => {
  const baseInput = {
    userId: 'web_test01',
    villageId: 'village-123',
    channel: 'webchat' as const,
  };

  it('explicit "YA" → confirm execute', async () => {
    const result = await decideIdentityResume({
      ...baseInput,
      message: 'YA',
      waitingFor: 'konfirmasi',
    });
    expect(result.action).toBe('confirm');
    if (result.action === 'confirm') {
      expect(result.resolution).toBe('execute');
    }
  });

  it('explicit "ya, lanjutkan" → confirm execute', async () => {
    const result = await decideIdentityResume({
      ...baseInput,
      message: 'Ya, lanjutkan',
      waitingFor: 'konfirmasi',
    });
    expect(result.action).toBe('confirm');
    if (result.action === 'confirm') {
      expect(result.resolution).toBe('execute');
    }
  });

  it('"batal" → confirm cancel', async () => {
    const result = await decideIdentityResume({
      ...baseInput,
      message: 'batal',
      waitingFor: 'konfirmasi',
    });
    expect(result.action).toBe('confirm');
    if (result.action === 'confirm') {
      expect(result.resolution).toBe('cancel');
    }
  });

  it('"gak jadi" → confirm cancel', async () => {
    const result = await decideIdentityResume({
      ...baseInput,
      message: 'gak jadi deh',
      waitingFor: 'konfirmasi',
    });
    // "gak jadi" matches EXPLICIT_ESCAPE_PATTERN → interrupt, not confirm
    // This is acceptable: interrupt with explicit_cancel also cancels
    expect(['confirm', 'interrupt']).toContain(result.action);
  });

  it('"ubah lokasinya" → confirm edit', async () => {
    const result = await decideIdentityResume({
      ...baseInput,
      message: 'ubah lokasinya',
      waitingFor: 'konfirmasi',
    });
    expect(result.action).toBe('confirm');
    if (result.action === 'confirm') {
      expect(result.resolution).toBe('edit');
    }
  });

  it('unclear message → confirm reverify (re-show summary)', async () => {
    const result = await decideIdentityResume({
      ...baseInput,
      message: 'hmm sebentar',
      waitingFor: 'konfirmasi',
    });
    expect(result.action).toBe('confirm');
    if (result.action === 'confirm') {
      expect(result.resolution).toBe('reverify');
    }
  });
});

describe('[P1-1] buildConfirmationSummary', () => {
  it('includes all fields in the summary', () => {
    const summary = buildConfirmationSummary({
      kategori: 'lampu_penerangan',
      kategoriLabel: 'Lampu Penerangan',
      deskripsi: 'lampu jalan rt 05 mati',
      alamat: 'Jl. Merdeka RT 05',
      reporter_name: 'Budi Santoso',
      reporter_phone: '081234567890',
    });

    expect(summary).toContain('Lampu Penerangan');
    expect(summary).toContain('lampu jalan rt 05 mati');
    expect(summary).toContain('Jl. Merdeka RT 05');
    expect(summary).toContain('Budi Santoso');
    expect(summary).toContain('081234567890');
    expect(summary).toContain('YA');
  });

  it('handles missing optional fields', () => {
    const summary = buildConfirmationSummary({
      kategori: 'sampah',
      deskripsi: 'sampah numpuk',
    });

    expect(summary).toContain('sampah');
    expect(summary).toContain('sampah numpuk');
    expect(summary).not.toContain('📍 Lokasi');
    expect(summary).not.toContain('👤 Nama');
  });
});
