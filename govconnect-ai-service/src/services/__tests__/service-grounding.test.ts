import { describe, it, expect } from 'vitest';
import { expandServiceAliases, SERVICE_ALIAS_MAP, findUniqueServiceMention } from '../service-grounding.utils';

describe('[P2-1] service alias expansion', () => {
  it('expands SKU to surat keterangan usaha', () => {
    expect(expandServiceAliases('mau ngurus SKU buat jualan')).toMatch(/surat keterangan usaha/i);
  });

  it('expands SKTM', () => {
    expect(expandServiceAliases('bikin SKTM')).toMatch(/surat keterangan tidak mampu/i);
  });

  it('expands suket (local abbreviation)', () => {
    expect(expandServiceAliases('mau bikin suket')).toMatch(/surat keterangan/i);
  });

  it('is case insensitive', () => {
    expect(expandServiceAliases('Mau bikin sku')).toMatch(/surat keterangan usaha/i);
  });

  it('findUniqueServiceMention finds service via alias', () => {
    const services = [
      { id: '1', name: 'Surat Keterangan Usaha', is_active: true },
      { id: '2', name: 'Kartu Tanda Penduduk', is_active: true },
    ] as any;
    const result = findUniqueServiceMention(services, ['mau ngurus SKU']);
    expect(result?.id).toBe('1');
  });
});
