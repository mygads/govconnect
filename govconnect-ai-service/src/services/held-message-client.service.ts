import axios from 'axios';
import { config } from '../config/env';
import logger from '../utils/logger';

export interface HoldMessageParams {
  villageId: string;
  channel: 'WHATSAPP' | 'WEBCHAT';
  channelIdentifier: string;
  messageId: string;
  messageText: string;
  hasMedia?: boolean;
  mediaType?: string;
  mediaUrl?: string;
  mediaPublicUrl?: string;
  mediaCaption?: string;
}

/**
 * Hold an inbound message in channel-service while the village AI wallet is
 * exhausted. The message is re-queued by an admin flush after topup, so the
 * citizen still gets a real AI answer instead of a rejection.
 */
export async function holdMessageForWallet(params: HoldMessageParams): Promise<boolean> {
  try {
    await axios.post(
      `${config.channelServiceUrl}/internal/held-messages/hold`,
      {
        village_id: params.villageId,
        channel: params.channel,
        channel_identifier: params.channelIdentifier,
        wa_user_id: params.channel === 'WHATSAPP' ? params.channelIdentifier : undefined,
        message_id: params.messageId,
        message_text: params.messageText,
        has_media: params.hasMedia ?? false,
        media_type: params.mediaType,
        media_url: params.mediaUrl,
        media_public_url: params.mediaPublicUrl,
        media_caption: params.mediaCaption,
      },
      {
        headers: {
          'x-internal-api-key': config.internalApiKey,
          'x-village-id': params.villageId,
        },
        timeout: 10000,
      }
    );
    logger.info('🪙 Held message for wallet-exhausted village', {
      villageId: params.villageId,
      channel: params.channel,
      channelIdentifier: params.channelIdentifier,
      messageId: params.messageId,
    });
    return true;
  } catch (error: any) {
    logger.error('Failed to hold message in channel-service', {
      villageId: params.villageId,
      messageId: params.messageId,
      error: error?.response?.data || error.message,
    });
    return false;
  }
}
