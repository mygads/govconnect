import { describe, it, expect, beforeEach } from 'vitest';
import { encryptSecret, decryptSecret, isCiphertext, scrubSecrets, _resetCryptoCacheForTests } from '../../utils/crypto';

describe('crypto', () => {
  beforeEach(() => {
    _resetCryptoCacheForTests();
  });

  it('roundtrips plaintext through encrypt/decrypt', () => {
    const plain = 'super-secret-api-key-123';
    const encrypted = encryptSecret(plain);
    expect(encrypted).not.toBe(plain);
    expect(isCiphertext(encrypted)).toBe(true);
    expect(decryptSecret(encrypted)).toBe(plain);
  });

  it('detects legacy plaintext and returns it unchanged', () => {
    const legacy = 'sk-my-old-plaintext-key';
    expect(isCiphertext(legacy)).toBe(false);
    expect(decryptSecret(legacy)).toBe(legacy);
  });

  it('idempotent encrypt: ciphertext is never re-encrypted', () => {
    const plain = 'foo';
    const once = encryptSecret(plain);
    const twice = encryptSecret(once);
    expect(twice).toBe(once);
  });

  it('rejects tampered ciphertext via auth tag', () => {
    const enc = encryptSecret('hello');
    const parts = enc.split(':');
    parts[3] = parts[3].replace(/.$/, (c) => (c === '0' ? '1' : '0'));
    const tampered = parts.join(':');
    expect(() => decryptSecret(tampered)).toThrow();
  });

  it('scrubs Bearer tokens and known key prefixes', () => {
    const text = 'Authorization: Bearer abc123XYZ; key sk-9999aaaaBBBB';
    const out = scrubSecrets(text);
    expect(out).toContain('Bearer ***');
    expect(out).toContain('sk-***');
    expect(out).not.toContain('abc123XYZ');
  });
});
