/**
 * Cross-service contract: WhatsApp button-id chain (channel → ai).
 *
 * P0-1 contract: the button id is AUTHORITATIVE for the G2/G3 confirmation
 * chain. channel-service extracts it opaquely from the webhook payload and
 * forwards it as `button_id` through the batcher → RabbitMQ → ai-service,
 * where confirmation.ts validates it against CONFIRM_BUTTON_IDS.
 *
 * This test FAILS if either side drifts:
 *  - ai-service changes CONFIRM_BUTTON_IDS without a coordinated update, or
 *  - channel-service's extractor mangles/drops a contract id, or
 *  - the extractor starts trusting display text (text must NEVER become an id).
 */
import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { CONFIRM_BUTTON_IDS } from '../confirmation';
// The module is dependency-free by design, safe to import across services.
// @ts-ignore: cross-service import — govconnect-channel-service is outside this package's rootDir; resolved at test runtime by vitest.
import { extractInteractiveResponseId, extractInteractiveResponseIdFromMessage } from '../../../../govconnect-channel-service/src/utils/interactive-response';

// The contract both services must agree on. If ai-service's list changes,
// update this deliberately — never silently.
const CONTRACT_BUTTON_IDS = ['confirm_send', 'edit_data', 'cancel_request'] as const;

describe('button-id cross-service contract', () => {
  it('ai-service CONFIRM_BUTTON_IDS matches the contract', () => {
    expect([...CONFIRM_BUTTON_IDS].sort()).toEqual([...CONTRACT_BUTTON_IDS].sort());
  });

  it('channel-service forwards every contract id unchanged (genfity-wa shape)', () => {
    for (const id of CONTRACT_BUTTON_IDS) {
      const response = { selectedButtonId: id, selectedButtonText: 'Ya, kirim' };
      expect(extractInteractiveResponseId(response)).toBe(id);
    }
  });

  it('channel-service forwards contract ids in Cloud-API interactive shape', () => {
    for (const id of CONTRACT_BUTTON_IDS) {
      const message = {
        interactiveResponseMessage: {
          button_reply: { id, title: 'Ya, kirim' },
        },
      };
      expect(extractInteractiveResponseIdFromMessage(message)).toBe(id);
    }
  });

  it('channel-service forwards contract ids in list-response shape', () => {
    for (const id of CONTRACT_BUTTON_IDS) {
      const message = {
        listResponseMessage: {
          singleSelectReply: { selectedRowId: id, title: 'Jalan rusak' },
        },
      };
      expect(extractInteractiveResponseIdFromMessage(message)).toBe(id);
    }
  });

  it('display text is NEVER trusted as an id', () => {
    // A response carrying only display text (no id field) must yield null —
    // the confirmation chain is fail-closed, text "Ya" must never execute.
    expect(
      extractInteractiveResponseId({ selectedButtonText: 'Ya, kirim' }),
    ).toBeNull();
    expect(
      extractInteractiveResponseIdFromMessage({
        buttonsResponseMessage: { selectedDisplayText: 'confirm_send' },
      }),
    ).toBeNull();
  });

  it('webhook controller still wires the extractor into the button_id path', () => {
    // Static guard against someone removing the forwarding call.
    const controllerPath = path.resolve(
      __dirname,
      '../../../../govconnect-channel-service/src/controllers/webhook.controller.ts',
    );
    const batcherPath = path.resolve(
      __dirname,
      '../../../../govconnect-channel-service/src/services/message-batcher.service.ts',
    );
    const controllerSrc = fs.readFileSync(controllerPath, 'utf8');
    const batcherSrc = fs.readFileSync(batcherPath, 'utf8');
    expect(controllerSrc).toContain('extractInteractiveResponseIdFromMessage');
    expect(batcherSrc).toContain('button_id');
  });
});
