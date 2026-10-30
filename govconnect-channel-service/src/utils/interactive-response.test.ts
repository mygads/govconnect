import test from 'node:test';
import assert from 'node:assert/strict';
import {
  extractInteractiveResponseId,
  extractInteractiveResponseIdFromMessage,
} from './interactive-response';

// P0-1 contract: button.id is authoritative for the G2/G3 confirmation chain.
// The id must be preferred over the display text, and null when absent.

test('prefers id fields over display-text fields', () => {
  const id = extractInteractiveResponseId({
    selectedButtonId: 'confirm_send',
    selectedButtonText: '✅ Benar, kirim',
  });
  assert.equal(id, 'confirm_send');
});

test('reads Genfity/WhatsApp Cloud nested button_reply.id', () => {
  const id = extractInteractiveResponseIdFromMessage({
    buttonsResponseMessage: {
      selectedButtonId: 'confirm_send',
      selectedButtonText: '✅ Benar, kirim',
    },
  });
  assert.equal(id, 'confirm_send');

  const cloud = extractInteractiveResponseIdFromMessage({
    interactive: { button_reply: { id: 'edit_data', title: 'Ubah data' } },
  });
  assert.equal(cloud, 'edit_data');
});

test('reads list row ids', () => {
  const id = extractInteractiveResponseIdFromMessage({
    listResponseMessage: { selectedRowId: 'row_keluhan', title: 'Keluhan' },
  });
  assert.equal(id, 'row_keluhan');
});

test('parses paramsJson fallback', () => {
  const id = extractInteractiveResponseId({
    paramsJson: JSON.stringify({ id: 'cancel_request' }),
  });
  assert.equal(id, 'cancel_request');
});

test('returns null when no id is present (text-only response)', () => {
  const id = extractInteractiveResponseIdFromMessage({
    buttonsResponseMessage: { selectedButtonText: 'Ya' },
  });
  assert.equal(id, null);
  assert.equal(extractInteractiveResponseId(null), null);
  assert.equal(extractInteractiveResponseId({}), null);
});
