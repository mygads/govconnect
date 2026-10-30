/**
 * Regression test: v2 service-confirmation detection (C2 parity).
 * "ok saya mau bikin" after service info must prefer 'service_request'
 * over the 'complaint' default in COLLECT.
 */
import { describe, it, expect } from 'vitest';
import { isServiceConfirmation, classifySlotIntent } from '../slot-fsm';

describe('isServiceConfirmation', () => {
  it('detects affirmative service confirmations', () => {
    expect(isServiceConfirmation('ok saya mau bikin')).toBe(true);
    expect(isServiceConfirmation('oke saya mau buat')).toBe(true);
    expect(isServiceConfirmation('ya mau lanjut')).toBe(true);
    expect(isServiceConfirmation('iya saya mau ajukan')).toBe(true);
    expect(isServiceConfirmation('siap mau daftar')).toBe(true);
    expect(isServiceConfirmation('saya mau bikin')).toBe(true);
  });

  it('rejects non-confirmations', () => {
    expect(isServiceConfirmation('jalan rusak di gang mawar')).toBe(false);
    expect(isServiceConfirmation('halo')).toBe(false);
    expect(isServiceConfirmation('batal')).toBe(false);
    expect(isServiceConfirmation('syarat ktp apa')).toBe(false);
  });

  it('classifySlotIntent returns null for ambiguous affirmations (fallback path)', () => {
    // These have no service/complaint keywords → null → caller applies
    // isServiceConfirmation before defaulting to 'complaint'.
    expect(classifySlotIntent('ok saya mau bikin')).toBeNull();
    expect(classifySlotIntent('ya mau lanjut')).toBeNull();
  });
});
