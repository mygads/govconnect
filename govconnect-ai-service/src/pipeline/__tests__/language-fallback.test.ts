/**
 * A3: regional-language fallback tests (pure — no DB).
 */
import { describe, it, expect } from 'vitest';
import { detectLanguage, shouldUseRegionalFallback, REGIONAL_FALLBACK_COPY } from '../language-fallback';

describe('detectLanguage', () => {
  it('detects Javanese', () => {
    const d = detectLanguage('piye carane ngurus KTP, aku ora ngerti');
    expect(d.language).toBe('jv');
    expect(shouldUseRegionalFallback(d)).toBe(true);
  });

  it('detects Sundanese', () => {
    const d = detectLanguage('kumaha carana ngadamel surat, abdi teu ngartos');
    expect(d.language).toBe('su');
    expect(shouldUseRegionalFallback(d)).toBe(true);
  });

  it('does not flag plain Indonesian', () => {
    const d = detectLanguage('bagaimana cara mengurus KTP? saya tidak mengerti');
    expect(shouldUseRegionalFallback(d)).toBe(false);
  });

  it('fail-open on a single marker word', () => {
    const d = detectLanguage('teh manis');
    expect(shouldUseRegionalFallback(d)).toBe(false);
  });

  it('fail-open on empty text', () => {
    const d = detectLanguage('');
    expect(d.language).toBe('unknown');
    expect(shouldUseRegionalFallback(d)).toBe(false);
  });

  it('Indonesian-dominant mixed text does not trigger', () => {
    const d = detectLanguage('saya mau bertanya tentang KTP dan bagaimana cara mengurusnya dengan benar');
    expect(shouldUseRegionalFallback(d)).toBe(false);
  });

  it('fallback copy is friendly and asks for Indonesian', () => {
    expect(REGIONAL_FALLBACK_COPY).toContain('Bahasa Indonesia');
    expect(REGIONAL_FALLBACK_COPY).not.toContain('error');
  });
});
