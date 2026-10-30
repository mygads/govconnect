/**
 * W8 — Rate limit webhook channel (per pengirim + instance).
 *
 * Menggunakan node:test (konvensi channel-service).
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  checkWebhookRateLimit,
  __resetWebhookRateLimit,
} from './webhook-rate-limit.middleware';

test('W8: pesan dalam batas → allowed', () => {
  __resetWebhookRateLimit();
  const r = checkWebhookRateLimit('6281234567890', 'desa-a');
  assert.equal(r.allowed, true);
});

test('W8: pengirim berbeda → counter terpisah', () => {
  __resetWebhookRateLimit();
  // Penuhi kuota pengirim pertama (30/menit default).
  for (let i = 0; i < 30; i++) {
    checkWebhookRateLimit('6281111111111', 'desa-a', 1000 + i);
  }
  const blocked = checkWebhookRateLimit('6281111111111', 'desa-a', 2000);
  assert.equal(blocked.allowed, false);
  assert.equal(blocked.reason, 'per_minute');

  // Pengirim lain tetap boleh.
  const other = checkWebhookRateLimit('6282222222222', 'desa-a', 2000);
  assert.equal(other.allowed, true);
});

test('W8: instance berbeda → counter terpisah', () => {
  __resetWebhookRateLimit();
  for (let i = 0; i < 30; i++) {
    checkWebhookRateLimit('6281234567890', 'desa-a', 1000 + i);
  }
  const blocked = checkWebhookRateLimit('6281234567890', 'desa-a', 2000);
  assert.equal(blocked.allowed, false);

  // Instance lain (desa lain) tetap boleh.
  const other = checkWebhookRateLimit('6281234567890', 'desa-b', 2000);
  assert.equal(other.allowed, true);
});

test('W8: window bergeser → boleh lagi', () => {
  __resetWebhookRateLimit();
  const base = 1_000_000;
  for (let i = 0; i < 30; i++) {
    checkWebhookRateLimit('6281234567890', 'desa-a', base + i);
  }
  const blocked = checkWebhookRateLimit('6281234567890', 'desa-a', base + 1000);
  assert.equal(blocked.allowed, false);

  // Setelah window (60s) berlalu → boleh lagi.
  const after = checkWebhookRateLimit('6281234567890', 'desa-a', base + 61_000);
  assert.equal(after.allowed, true);
});

test('W8: retryAfterMs diberikan saat diblokir', () => {
  __resetWebhookRateLimit();
  const base = 2_000_000;
  for (let i = 0; i < 30; i++) {
    checkWebhookRateLimit('6281234567890', 'desa-a', base + i * 100);
  }
  const blocked = checkWebhookRateLimit('6281234567890', 'desa-a', base + 3000);
  assert.equal(blocked.allowed, false);
  assert.ok(
    typeof blocked.retryAfterMs === 'number' && blocked.retryAfterMs > 0,
    'retryAfterMs harus positif',
  );
});
