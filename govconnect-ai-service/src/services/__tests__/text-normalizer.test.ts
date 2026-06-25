/**
 * Text Normalizer Tests — verifies colloquial/regional/dialect normalization
 * to standard Indonesian. This ensures the AI agent can understand villagers
 * who speak Javanese, Sundanese, Buginese, or use informal slang.
 */

import { describe, it, expect } from 'vitest';
import { normalizeText } from '../text-normalizer.service';

describe('text-normalizer: regional dialect normalization', () => {
  describe('Javanese phrases', () => {
    it('normalizes "badhe damel KTP" → "ingin membuat KTP"', () => {
      expect(normalizeText('badhe damel KTP')).toBe('ingin membuat KTP');
    });

    it('normalizes "damel surat" → "membuat surat"', () => {
      expect(normalizeText('mau damel surat domisili')).toBe('ingin membuat surat domisili');
    });

    it('normalizes "ngurus akta" → "mengurus akta"', () => {
      expect(normalizeText('ngurus akta kelahiran')).toBe('mengurus akta kelahiran');
    });

    it('normalizes "ngadamel surat" → "membuat surat"', () => {
      expect(normalizeText('ngadamel surat pindah')).toBe('membuat surat pindah');
    });

    it('normalizes "nggawe KTP" → "membuat KTP"', () => {
      expect(normalizeText('nggawe KTP')).toBe('membuat KTP');
    });

    it('normalizes question words', () => {
      expect(normalizeText('piye carane ngurus KTP')).toBe('bagaimana caranya mengurus KTP');
      expect(normalizeText('sopo kepala desa')).toBe('siapa kepala desa');
      expect(normalizeText('opo syaratnya')).toBe('apa syaratnya');
    });

    it('normalizes demonstratives', () => {
      // "niki" → "ini" is normalized; suffix "-e" (Javanese possessive) is
      // intentionally NOT mapped to avoid over-correction of unintended words.
      // The AI agent understands "-e" from context.
      expect(normalizeText('niki dokumene')).toBe('ini dokumene');
      expect(normalizeText('niku kantor')).toBe('itu kantor');
    });

    it('normalizes affirmations', () => {
      expect(normalizeText('nggih benar')).toBe('iya benar');
    });
  });

  describe('Sundanese phrases', () => {
    it('normalizes "kumaha cara ngurus" → "bagaimana cara mengurus"', () => {
      expect(normalizeText('kumaha cara ngurus akta')).toBe('bagaimana cara mengurus akta');
    });

    it('normalizes standalone "kumaha" → "bagaimana"', () => {
      expect(normalizeText('kumaha jam buka kantor')).toBe('bagaimana jam buka kantor');
    });

    it('normalizes negation words', () => {
      expect(normalizeText('teu bisa')).toBe('tidak bisa');
      expect(normalizeText('henteu mengerti')).toBe('tidak mengerti');
      expect(normalizeText('enteu ada')).toBe('tidak ada');
    });
  });

  describe('Buginese phrases', () => {
    it('normalizes "engka surat" → "ada surat"', () => {
      expect(normalizeText('engka surat pindah?')).toBe('ada surat pindah?');
    });

    it('normalizes greeting "tabe" → "permisi"', () => {
      expect(normalizeText('tabe, engka surat domisili?')).toBe('permisi, ada surat domisili?');
    });
  });

  describe('colloquial service request phrases', () => {
    it('normalizes "bikin KTP" → "membuat KTP" (via bikin→buat then phrase)', () => {
      // Note: word-level "bikin" → "buat" happens first, then phrase-level "buat KTP" → "membuat KTP"
      expect(normalizeText('bikin KTP')).toBe('membuat KTP');
    });

    it('normalizes "ngurus surat" → "mengurus surat"', () => {
      expect(normalizeText('ngurus surat kematian')).toBe('mengurus surat kematian');
    });

    it('normalizes "urus KK" → "mengurus KK"', () => {
      expect(normalizeText('urus KK')).toBe('mengurus KK');
    });

    it('normalizes combined colloquial + regional', () => {
      expect(normalizeText('badhe damel akta')).toBe('ingin membuat akta');
      expect(normalizeText('ngadamel surat nikah')).toBe('membuat surat nikah');
    });
  });

  describe('existing normalization still works', () => {
    it('normalizes abbreviations', () => {
      expect(normalizeText('jm bk')).toBe('jam buka');
      expect(normalizeText('jln melati')).toBe('jalan melati');
    });

    it('normalizes typos', () => {
      expect(normalizeText('srat domisili')).toBe('surat domisili');
      expect(normalizeText('sktm')).toBe('SKTM');
    });

    it('normalizes informal pronouns', () => {
      expect(normalizeText('gue mau tanya')).toBe('saya ingin tanya');
      expect(normalizeText('aku butuh bantuan')).toBe('saya perlu bantuan');
    });

    it('normalizes negations', () => {
      expect(normalizeText('gak bisa')).toBe('tidak bisa');
      expect(normalizeText('nggak ada')).toBe('tidak ada');
    });
  });
});

describe('text-normalizer: idempotency and edge cases', () => {
  it('handles empty input', () => {
    expect(normalizeText('')).toBe('');
  });

  it('handles already-normalized text', () => {
    const text = 'ingin membuat KTP';
    expect(normalizeText(text)).toBe(text);
  });

  it('preserves case for acronyms', () => {
    expect(normalizeText('KTP')).toBe('KTP');
    expect(normalizeText('SKTM')).toBe('SKTM');
    expect(normalizeText('RT/RW')).toBe('RT/RW');
  });

  it('handles mixed-case input', () => {
    expect(normalizeText('BADHE DAMEL KTP')).toBe('ingin membuat KTP');
    expect(normalizeText('Badhe Damel KTP')).toBe('ingin membuat KTP');
  });
});
