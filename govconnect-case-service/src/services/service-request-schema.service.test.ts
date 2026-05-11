import test from 'node:test';
import assert from 'node:assert/strict';
import { buildServiceRequestSchema, validateServiceRequestPayload } from './service-request-schema.service';

function buildSchema() {
  return buildServiceRequestSchema({
    mode: 'online',
    citizen_fields_json: [{ key: 'nama_lengkap', is_required: false }],
    requirements: [
      {
        id: 'req-file',
        label: 'KTP',
        field_type: 'file',
        is_required: true,
        help_text: null,
        options_json: null,
      },
    ],
  });
}

test('accepts structured uploaded requirement file metadata', () => {
  const result = validateServiceRequestPayload(
    buildSchema(),
    {},
    {
      'req-file': {
        url: 'https://example.test/uploads/ktp.pdf',
        internal_url: 'https://channel.internal/uploads/ktp.pdf',
        file_name: 'ktp.pdf',
        mime_type: 'application/pdf',
        size: 1024,
        storage_key: 'public-uploads/village-1/ktp.pdf',
      },
    },
  );

  assert.equal(result.ok, true);
  assert.deepEqual(result.errors, []);
  assert.equal(typeof result.requirementData['req-file'], 'object');
});

test('rejects unsupported uploaded requirement file mime type', () => {
  const result = validateServiceRequestPayload(
    buildSchema(),
    {},
    {
      'req-file': {
        url: 'https://example.test/uploads/ktp.exe',
        mime_type: 'application/x-msdownload',
        size: 1024,
      },
    },
  );

  assert.equal(result.ok, false);
  assert.match(result.errors[0] || '', /tipe file yang tidak didukung/i);
});

test('rejects oversized uploaded requirement files', () => {
  const result = validateServiceRequestPayload(
    buildSchema(),
    {},
    {
      'req-file': {
        url: 'https://example.test/uploads/ktp.pdf',
        mime_type: 'application/pdf',
        size: 10 * 1024 * 1024 + 1,
      },
    },
  );

  assert.equal(result.ok, false);
  assert.match(result.errors[0] || '', /ukuran file yang tidak valid/i);
});

test('rejects invalid internal upload URLs', () => {
  const result = validateServiceRequestPayload(
    buildSchema(),
    {},
    {
      'req-file': {
        url: 'https://example.test/uploads/ktp.pdf',
        internal_url: 'javascript:alert(1)',
        mime_type: 'application/pdf',
        size: 1024,
      },
    },
  );

  assert.equal(result.ok, false);
  assert.match(result.errors[0] || '', /internal_url yang tidak valid/i);
});
