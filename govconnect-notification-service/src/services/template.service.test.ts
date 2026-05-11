import test from 'node:test';
import assert from 'node:assert/strict';
import { buildServiceRequestedMessage } from './template.service';

test('service requested message mentions WhatsApp for WhatsApp channel', () => {
  const message = buildServiceRequestedMessage({
    request_number: 'LAY-001',
    service_name: 'Surat Domisili',
    channel: 'WHATSAPP',
  });

  assert.match(message, /WhatsApp ini/);
});

test('service requested message mentions current conversation for webchat channel', () => {
  const message = buildServiceRequestedMessage({
    request_number: 'LAY-001',
    service_name: 'Surat Domisili',
    channel: 'WEBCHAT',
  });

  assert.match(message, /percakapan ini/);
  assert.doesNotMatch(message, /WhatsApp ini/);
});
