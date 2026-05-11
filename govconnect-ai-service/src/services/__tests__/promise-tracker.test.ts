import { beforeEach, describe, expect, it } from 'vitest';

import {
  extractAndRecordPromises,
  listOpenPromises,
  clearOpenPromises,
  resolvePromisesByKind,
  buildOpenPromisesContext,
  deriveFulfilledPromisesFromTools,
  resolveForwardPromiseOnTakeover,
  _resetPromiseStoreForTests,
} from '../promise-tracker.service';

const USER = 'promise-user-1';

describe('promise-tracker', () => {
  beforeEach(() => {
    _resetPromiseStoreForTests();
  });

  it('records a will_check promise from "saya cek dulu"', () => {
    extractAndRecordPromises(USER, 'Baik Pak/Bu, saya cek dulu informasinya ya.');
    const open = listOpenPromises(USER);
    expect(open).toHaveLength(1);
    expect(open[0].kind).toBe('will_check');
  });

  it('records a will_forward promise from "saya teruskan ke petugas"', () => {
    extractAndRecordPromises(USER, 'Baik Pak/Bu, saya teruskan ke petugas ya.');
    const open = listOpenPromises(USER);
    expect(open.some((p) => p.kind === 'will_forward')).toBe(true);
  });

  it('ignores replies without any promise phrase', () => {
    extractAndRecordPromises(USER, 'Terima kasih Pak/Bu, sudah saya bantu.');
    expect(listOpenPromises(USER)).toHaveLength(0);
  });

  it('caps stored promises and de-dups by kind within 2-minute window', () => {
    extractAndRecordPromises(USER, 'saya cek dulu');
    extractAndRecordPromises(USER, 'saya cek dulu');
    extractAndRecordPromises(USER, 'saya cek dulu');
    const open = listOpenPromises(USER);
    expect(open.length).toBeLessThanOrEqual(5);
    // Only one kind-bucket should accumulate due to de-dup.
    expect(open.filter((p) => p.kind === 'will_check').length).toBe(1);
  });

  it('resolves by kind', () => {
    extractAndRecordPromises(USER, 'saya cek dulu');
    extractAndRecordPromises(USER, 'saya teruskan ke petugas');
    resolvePromisesByKind(USER, ['will_check']);
    const remaining = listOpenPromises(USER);
    expect(remaining.some((p) => p.kind === 'will_check')).toBe(false);
    expect(remaining.some((p) => p.kind === 'will_forward')).toBe(true);
  });

  it('clears all promises', () => {
    extractAndRecordPromises(USER, 'saya cek dulu');
    clearOpenPromises(USER);
    expect(listOpenPromises(USER)).toHaveLength(0);
  });

  it('maps tool usage to fulfilled promises', () => {
    const fulfilled = deriveFulfilledPromisesFromTools(['create_complaint']);
    expect(fulfilled).toContain('will_process');
    expect(fulfilled).toContain('will_remember');
    expect(fulfilled).toContain('will_forward');
  });

  it('resolveForwardPromiseOnTakeover clears will_forward + will_confirm_later', () => {
    extractAndRecordPromises(USER, 'saya teruskan ke petugas');
    extractAndRecordPromises(USER, 'mohon tunggu sebentar ya pak');
    resolveForwardPromiseOnTakeover(USER);
    const kinds = listOpenPromises(USER).map((p) => p.kind);
    expect(kinds).not.toContain('will_forward');
    expect(kinds).not.toContain('will_confirm_later');
  });

  it('builds open-promise context when there are open promises', () => {
    extractAndRecordPromises(USER, 'saya cek dulu');
    const ctx = buildOpenPromisesContext(USER);
    expect(ctx).toMatch(/janji tindak lanjut|tindak lanjuti|update/i);
    expect(ctx.length).toBeGreaterThan(0);
  });

  it('suppresses open-promise context on unrelated topic shifts when current message is provided', () => {
    extractAndRecordPromises(USER, 'saya cek dulu');
    expect(buildOpenPromisesContext(USER, undefined, 'alamat kantor desa dimana?')).toBe('');
  });

  it('keeps open-promise context on follow-up turns that ask for progress', () => {
    extractAndRecordPromises(USER, 'saya cek dulu');
    const ctx = buildOpenPromisesContext(USER, undefined, 'jadi gimana update nya?');
    expect(ctx).toMatch(/update yang konkret|janji tindak lanjut/i);
  });

  it('returns empty context when nothing open', () => {
    expect(buildOpenPromisesContext(USER)).toBe('');
  });
});
