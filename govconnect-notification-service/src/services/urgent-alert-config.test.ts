import test from 'node:test';
import assert from 'node:assert/strict';
import { extractAdminNotificationNumber } from './urgent-alert-config';

test('extracts admin notification number from village behavior payload', () => {
  assert.equal(
    extractAdminNotificationNumber({
      data: {
        config: {
          admin_notification_number: '6281234567890',
        },
      },
    }),
    '6281234567890',
  );
});

test('returns null for legacy village profile payload without behavior config', () => {
  assert.equal(
    extractAdminNotificationNumber({
      data: {
        admin_notification_number: '6281234567890',
      },
    }),
    null,
  );
});

test('normalizes blank values to null', () => {
  assert.equal(
    extractAdminNotificationNumber({
      data: {
        config: {
          admin_notification_number: '   ',
        },
      },
    }),
    null,
  );
});
