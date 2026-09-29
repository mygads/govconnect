/**
 * A2: glossary normalization tests (pure — no DB).
 */
import { describe, it, expect } from 'vitest';
import { normalizeWithGlossary } from '../glossary';

const ENTRIES = [
  { istilah: 'dalane', bentukBaku: 'jalannya' },
  { istilah: 'dalan', bentukBaku: 'jalan' },
  { istilah: 'bade', bentukBaku: 'mau' },
  { istilah: 'ngadamel', bentukBaku: 'membuat' },
  { istilah: 'surat pengantar', bentukBaku: 'surat pengantar desa' },
];

describe('normalizeWithGlossary', () => {
  it('replaces whole words case-insensitively', () => {
    const r = normalizeWithGlossary('Dalane rusak parah', ENTRIES);
    expect(r.text).toBe('jalannya rusak parah');
    expect(r.applied).toEqual([{ istilah: 'dalane', bentukBaku: 'jalannya' }]);
  });

  it('longest term wins (surat pengantar before surat)', () => {
    const r = normalizeWithGlossary('minta surat pengantar', ENTRIES);
    expect(r.text).toBe('minta surat pengantar desa');
  });

  it('does not replace inside other words', () => {
    const r = normalizeWithGlossary('kedaluwarsa', [{ istilah: 'dalu', bentukBaku: 'X' }]);
    expect(r.text).toBe('kedaluwarsa');
    expect(r.applied).toEqual([]);
  });

  it('handles empty input and empty glossary', () => {
    expect(normalizeWithGlossary('', ENTRIES).text).toBe('');
    expect(normalizeWithGlossary('halo', []).applied).toEqual([]);
  });

  it('normalizes a mixed Javanese sentence', () => {
    const r = normalizeWithGlossary('bade ngadamel KTP', ENTRIES);
    expect(r.text).toBe('mau membuat KTP');
    expect(r.applied.length).toBe(2);
  });
});
