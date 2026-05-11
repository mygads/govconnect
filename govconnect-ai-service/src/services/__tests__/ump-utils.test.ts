import { describe, it, expect } from 'vitest';
import { deriveLastDiscussedServiceContext } from '../ump-utils';

describe('deriveLastDiscussedServiceContext', () => {
  it('extracts the service name from recent assistant replies', () => {
    const context = deriveLastDiscussedServiceContext([
      { role: 'user', content: 'surat domisili gimana ya?' },
      { role: 'assistant', content: 'Untuk layanan *Surat Keterangan Domisili*, persyaratannya seperti ini ya Pak/Bu.' },
    ]);

    expect(context).toEqual({ serviceName: 'Surat Keterangan Domisili' });
  });

  it('ignores service request reference numbers and keeps searching for a real service name', () => {
    const context = deriveLastDiscussedServiceContext([
      { role: 'assistant', content: 'Untuk layanan *Surat Pengantar KTP*, saya bisa bantu jelaskan syaratnya.' },
      { role: 'assistant', content: 'Permohonan layanan *LAY-20260510-001* belum saya temukan. Coba cek lagi nomornya ya Pak/Bu.' },
    ]);

    expect(context).toEqual({ serviceName: 'Surat Pengantar KTP' });
  });

  it('stops service-name capture before trailing status text on plain responses', () => {
    const context = deriveLastDiscussedServiceContext([
      { role: 'assistant', content: 'Mohon maaf Pak/Bu, layanan Surat Pengantar KTP saat ini belum tersedia.' },
    ]);

    expect(context).toEqual({ serviceName: 'Surat Pengantar KTP' });
  });
});
