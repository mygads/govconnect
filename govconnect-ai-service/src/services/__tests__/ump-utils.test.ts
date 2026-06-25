import { describe, it, expect } from 'vitest';
import { deriveLastDiscussedServiceContext } from '../ump-utils';
import { isProcessingFailure } from '../unified-message-processor.service';
import type { ProcessMessageResult } from '../ump-types';

function mkResult(over: Partial<ProcessMessageResult>): ProcessMessageResult {
  return {
    success: true,
    response: '',
    intent: 'AGENT',
    metadata: { processingTimeMs: 0, hasKnowledge: false },
    ...over,
  } as ProcessMessageResult;
}

describe('isProcessingFailure', () => {
  it('flags an explicit failure (success=false with error)', () => {
    expect(isProcessingFailure(mkResult({ success: false, error: 'AGENT_ERROR' }))).toBe(true);
  });

  it('flags an empty reply even if success=true (backward-compat)', () => {
    expect(isProcessingFailure(mkResult({ success: true, response: '' }))).toBe(true);
    expect(isProcessingFailure(mkResult({ success: true, response: '   ' }))).toBe(true);
  });

  it('flags legacy apology strings that slipped through as success=true', () => {
    expect(isProcessingFailure(mkResult({ success: true, response: 'Maaf, saya membutuhkan waktu lebih lama untuk memproses permintaan ini.' }))).toBe(true);
    expect(isProcessingFailure(mkResult({ success: true, response: 'Maaf, terjadi gangguan pada sistem.' }))).toBe(true);
  });

  it('does NOT flag a real grounded answer', () => {
    expect(isProcessingFailure(mkResult({ success: true, response: 'Kantor desa buka 08:00-15:00 WITA.' }))).toBe(false);
  });

  it('does NOT flag a legit not-found answer (knowledge tool ran, no match)', () => {
    expect(isProcessingFailure(mkResult({ success: true, response: 'Maaf Pak/Bu, informasinya belum berhasil kami temukan sekarang.' }))).toBe(false);
  });
});

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
