/**
 * Regression tests for pickArgString — the alias resolver used by the mutation
 * tools (create_complaint / update_complaint / get_service_info).
 *
 * Root cause it guards: deepseek-v4-flash ignores the strict tool schema's
 * Indonesian param names (alamat/deskripsi/service_name) and emits English keys
 * (address/description/service). The tool then read empty Indonesian fields and
 * falsely rejected a complaint that already had its address + description — asking
 * the citizen for the location they had just given. pickArgString accepts both.
 */

import { describe, it, expect, vi } from 'vitest';

vi.mock('../../../utils/logger', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import { pickArgString } from '../tool-executor';

describe('pickArgString — Indonesian/English key aliasing', () => {
  it('prefers the canonical Indonesian key when present', () => {
    expect(pickArgString({ alamat: 'RT 03', address: 'ignored' }, 'alamat', 'address')).toBe('RT 03');
  });

  it('falls back to the English alias the model actually emitted', () => {
    const args = { address: 'RT 03 RW 02 Jalan Melati', description: 'Jalan rusak parah' };
    expect(pickArgString(args, 'alamat', 'address', 'location')).toBe('RT 03 RW 02 Jalan Melati');
    expect(pickArgString(args, 'deskripsi', 'description', 'desc')).toBe('Jalan rusak parah');
  });

  it('trims whitespace and skips blank/whitespace-only values', () => {
    expect(pickArgString({ alamat: '   ', address: '  RT 03  ' }, 'alamat', 'address')).toBe('RT 03');
  });

  it('returns empty string when no alias matches', () => {
    expect(pickArgString({ foo: 'bar' }, 'alamat', 'address')).toBe('');
  });

  it('ignores non-string values', () => {
    expect(pickArgString({ alamat: 123 as unknown as string, address: 'RT 03' }, 'alamat', 'address')).toBe('RT 03');
  });
});
