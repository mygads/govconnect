import test from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'crypto';
import { validateWebhookSignature } from './webhook-signature';

const secret = 'super-secret-webhook-key';
const body = Buffer.from(JSON.stringify({ type: 'Message', event: { Info: { ID: 'abc' } } }));
const digest = createHmac('sha256', secret).update(body).digest('hex');

test('accepts valid sha256-prefixed webhook signatures', () => {
  assert.equal(validateWebhookSignature(`sha256=${digest}`, body, secret), true);
});

test('accepts valid raw hex webhook signatures', () => {
  assert.equal(validateWebhookSignature(digest, body, secret), true);
});

test('rejects mismatched webhook signatures', () => {
  assert.equal(validateWebhookSignature('sha256=deadbeef', body, secret), false);
});

test('rejects malformed webhook signatures', () => {
  assert.equal(validateWebhookSignature('sha256=this-is-not-hex', body, secret), false);
});
