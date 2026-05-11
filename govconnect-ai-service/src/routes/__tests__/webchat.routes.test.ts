import { describe, expect, it } from 'vitest';
import { __test_only__ } from '../webchat.routes';

const { resolveWebchatAIStatusAfterReply } = __test_only__;

describe('resolveWebchatAIStatusAfterReply', () => {
  it('keeps pending balance when AI balance is exhausted', () => {
    expect(
      resolveWebchatAIStatusAfterReply({
        intent: 'AI_BALANCE_EXHAUSTED',
        replySynced: false,
        hasGuidance: true,
        guidanceSynced: false,
      })
    ).toEqual({ action: 'pending_balance' });
  });

  it('returns an error when the main reply is not synced', () => {
    expect(
      resolveWebchatAIStatusAfterReply({
        intent: 'GENERAL_INFO',
        replySynced: false,
        hasGuidance: false,
        guidanceSynced: true,
      })
    ).toEqual({
      action: 'error',
      error_message: 'Balasan AI siap, tetapi sinkronisasi ke dashboard live chat gagal.',
    });
  });

  it('returns an error when guidance sync fails', () => {
    expect(
      resolveWebchatAIStatusAfterReply({
        intent: 'GENERAL_INFO',
        replySynced: true,
        hasGuidance: true,
        guidanceSynced: false,
      })
    ).toEqual({
      action: 'error',
      error_message: 'Balasan AI siap, tetapi sinkronisasi pesan panduan ke dashboard live chat gagal.',
    });
  });

  it('clears the AI status only when all reply content is synced', () => {
    expect(
      resolveWebchatAIStatusAfterReply({
        intent: 'GENERAL_INFO',
        replySynced: true,
        hasGuidance: false,
        guidanceSynced: true,
      })
    ).toEqual({ action: 'clear' });

    expect(
      resolveWebchatAIStatusAfterReply({
        intent: 'GENERAL_INFO',
        replySynced: true,
        hasGuidance: true,
        guidanceSynced: true,
      })
    ).toEqual({ action: 'clear' });
  });
});
