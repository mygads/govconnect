import test from 'node:test';
import assert from 'node:assert/strict';
import { mergeComplaintClassification } from './complaint-classification';

test('authoritative complaint type config overrides client-provided urgency and category fields', () => {
  const result = mergeComplaintClassification(
    {
      type_id: 'client-type',
      category_id: 'client-category',
      is_urgent: true,
      require_address: false,
    },
    {
      type_id: 'db-type',
      category_id: 'db-category',
      is_urgent: false,
      require_address: true,
    },
  );

  assert.deepEqual(result, {
    type_id: 'db-type',
    category_id: 'db-category',
    is_urgent: false,
    require_address: true,
  });
});

test('fallback keeps normalized request values when no authoritative config is available', () => {
  const result = mergeComplaintClassification(
    {
      is_urgent: true,
      require_address: true,
    },
    null,
  );

  assert.deepEqual(result, {
    type_id: '',
    category_id: '',
    is_urgent: true,
    require_address: true,
  });
});
