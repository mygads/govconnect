/**
 * P1-4 NIK Validation Tests — Round 2 Tim C findings.
 *
 * Tests for tryHandleNikValidation:
 * - "NIK saya 12345" → rejected (not 16 digits)
 * - "NIK saya 3273010101900001" → passes (valid 16 digits)
 * - Message without NIK mention → null (falls through)
 */

import { describe, it, expect } from 'vitest';

import { tryHandleNikValidation } from '../pre-agent-state-router.service';

describe('[P1-4] NIK validation', () => {
  const baseInput = {
    traceId: 'test-trace',
    startTime: Date.now(),
  };

  it('rejects NIK with 5 digits', () => {
    const result = tryHandleNikValidation({
      ...baseInput,
      message: 'NIK saya 12345',
    });
    expect(result).not.toBeNull();
    expect(result?.intent).toBe('IDENTITY_CHECK');
    expect(result?.response).toContain('16 digit');
  });

  it('rejects NIK with 15 digits', () => {
    const result = tryHandleNikValidation({
      ...baseInput,
      message: 'nik 327301010190000',
    });
    expect(result).not.toBeNull();
    expect(result?.intent).toBe('IDENTITY_CHECK');
  });

  it('rejects NIK with 17 digits', () => {
    const result = tryHandleNikValidation({
      ...baseInput,
      message: 'NIK saya 32730101019000012',
    });
    expect(result).not.toBeNull();
    expect(result?.intent).toBe('IDENTITY_CHECK');
  });

  it('accepts valid 16-digit NIK (falls through)', () => {
    const result = tryHandleNikValidation({
      ...baseInput,
      message: 'NIK saya 3273010101900001',
    });
    expect(result).toBeNull();
  });

  it('ignores messages without NIK mention', () => {
    const result = tryHandleNikValidation({
      ...baseInput,
      message: 'lampu jalan rt 05 mati',
    });
    expect(result).toBeNull();
  });

  it('ignores "nomor induk kependudukan" without digits', () => {
    const result = tryHandleNikValidation({
      ...baseInput,
      message: 'apa itu nomor induk kependudukan?',
    });
    expect(result).toBeNull();
  });

  it('rejects NIK with letters mixed in', () => {
    const result = tryHandleNikValidation({
      ...baseInput,
      message: 'nik saya 32730101019000ab',
    });
    expect(result).not.toBeNull();
    expect(result?.intent).toBe('IDENTITY_CHECK');
  });
});
