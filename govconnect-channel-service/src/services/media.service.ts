import logger from '../utils/logger';
import { GenfityWebhookPayload, GenfityMediaMessage } from '../types/webhook.types';
import { getAccessTokenForVillage, waGatewayRequest } from './wa.service';
import { uploadBufferToObjectStorage } from './object-storage.service';
import { logWaActivity } from './wa-activity-log.service';

export interface MediaInfo {
  hasMedia: boolean;
  mediaType?: 'image' | 'video' | 'audio' | 'document' | 'sticker';
  mediaUrl?: string;           // Internal URL for Docker network (Case Service)
  mediaPublicUrl?: string;     // Public URL for browser access (Dashboard)
  mimeType?: string;
  fileName?: string;
  caption?: string;
  fileSize?: number;
  storageKey?: string;
}

export interface DownloadMediaParams {
  url: string;
  directPath?: string;
  mediaKey: string;
  mimetype: string;
  fileSha256: string;
  fileLength: number;
  fileEncSha256?: string;
}

function getStringField(source: any, keys: string[]): string {
  for (const key of keys) {
    const value = source?.[key];
    if (typeof value === 'string' && value.length > 0) return value;
  }
  return '';
}

function getNumberField(source: any, keys: string[]): number {
  for (const key of keys) {
    const value = source?.[key];
    if (typeof value === 'number') return value;
    if (typeof value === 'string' && value.trim()) {
      const parsed = Number(value);
      if (Number.isFinite(parsed)) return parsed;
    }
  }
  return 0;
}

function getMediaField(message: GenfityMediaMessage, keys: string[]): string {
  return getStringField(message as any, keys);
}

function getMediaFileLength(message: GenfityMediaMessage): number {
  return getNumberField(message as any, ['FileLength', 'fileLength', 'file_length']);
}

/**
 * Extract media information from webhook payload
 */
export function extractMediaInfo(payload: GenfityWebhookPayload): MediaInfo {
  // Check if S3 data is available (preferred)
  if (payload.s3?.url) {
    return {
      hasMedia: true,
      mediaType: getMediaTypeFromMime(payload.s3.mimeType),
      mediaUrl: payload.s3.url,
      mediaPublicUrl: payload.s3.url,
      mimeType: payload.s3.mimeType,
      fileName: payload.s3.fileName,
      fileSize: payload.s3.size,
      storageKey: payload.s3.key,
    };
  }

  // Check if base64 data is available
  if (payload.base64 && payload.mimeType) {
    return {
      hasMedia: true,
      mediaType: getMediaTypeFromMime(payload.mimeType),
      mimeType: payload.mimeType,
      fileName: payload.fileName,
      // Will be processed later (save base64 to file)
    };
  }

  // Check Message object for media
  const msg = payload.event?.Message;
  if (!msg) {
    return { hasMedia: false };
  }

  // Check for image message
  if (msg.ImageMessage || (msg as any).imageMessage) {
    const imgMsg = msg.ImageMessage || (msg as any).imageMessage;
    return {
      hasMedia: true,
      mediaType: 'image',
      mimeType: imgMsg.Mimetype || imgMsg.mimetype,
      caption: imgMsg.Caption || imgMsg.caption,
      fileSize: imgMsg.FileLength || imgMsg.fileLength,
      // URL needs to be downloaded via genfity-wa API
    };
  }

  // Check for video message
  if (msg.VideoMessage || (msg as any).videoMessage) {
    const vidMsg = msg.VideoMessage || (msg as any).videoMessage;
    return {
      hasMedia: true,
      mediaType: 'video',
      mimeType: vidMsg.Mimetype || vidMsg.mimetype,
      caption: vidMsg.Caption || vidMsg.caption,
      fileSize: vidMsg.FileLength || vidMsg.fileLength,
    };
  }

  // Check for audio message
  if (msg.AudioMessage || (msg as any).audioMessage) {
    const audMsg = msg.AudioMessage || (msg as any).audioMessage;
    return {
      hasMedia: true,
      mediaType: 'audio',
      mimeType: audMsg.Mimetype || audMsg.mimetype,
      fileSize: audMsg.FileLength || audMsg.fileLength,
    };
  }

  // Check for document message
  if (msg.DocumentMessage || (msg as any).documentMessage) {
    const docMsg = msg.DocumentMessage || (msg as any).documentMessage;
    return {
      hasMedia: true,
      mediaType: 'document',
      mimeType: docMsg.Mimetype || docMsg.mimetype,
      fileName: (docMsg as any).FileName || (docMsg as any).fileName,
      caption: docMsg.Caption || docMsg.caption,
      fileSize: docMsg.FileLength || docMsg.fileLength,
    };
  }

  // Check for sticker message
  if (msg.StickerMessage || (msg as any).stickerMessage) {
    const stkMsg = msg.StickerMessage || (msg as any).stickerMessage;
    return {
      hasMedia: true,
      mediaType: 'sticker',
      mimeType: stkMsg.Mimetype || stkMsg.mimetype,
      fileSize: stkMsg.FileLength || stkMsg.fileLength,
    };
  }

  return { hasMedia: false };
}

/**
 * Get media type from MIME type
 */
function getMediaTypeFromMime(mimeType: string): 'image' | 'video' | 'audio' | 'document' | 'sticker' {
  if (!mimeType) return 'document';
  
  if (mimeType.startsWith('image/webp')) return 'sticker';
  if (mimeType.startsWith('image/')) return 'image';
  if (mimeType.startsWith('video/')) return 'video';
  if (mimeType.startsWith('audio/')) return 'audio';
  return 'document';
}

/**
 * Get file extension from MIME type
 */
function getExtensionFromMime(mimeType: string): string {
  const mimeToExt: Record<string, string> = {
    'image/jpeg': 'jpg',
    'image/jpg': 'jpg',
    'image/png': 'png',
    'image/gif': 'gif',
    'image/webp': 'webp',
    'video/mp4': 'mp4',
    'video/3gpp': '3gp',
    'audio/ogg': 'ogg',
    'audio/mpeg': 'mp3',
    'audio/mp4': 'm4a',
    'application/pdf': 'pdf',
    'application/msword': 'doc',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx',
  };
  return mimeToExt[mimeType] || 'bin';
}

/**
 * Result from saving media
 */
export interface SavedMediaResult {
  internalUrl: string;  // For Docker network (Case Service)
  publicUrl: string;    // For browser (Dashboard)
  storageKey: string;
}

/**
 * Save base64 media to object storage
 */
export async function saveBase64Media(
  base64Data: string,
  mimeType: string,
  waUserId: string,
  messageId: string
): Promise<SavedMediaResult | null> {
  try {
    const ext = getExtensionFromMime(mimeType);
    const filename = `${messageId}.${ext}`;

    // Remove data URL prefix if present
    const base64Content = base64Data.replace(/^data:[^;]+;base64,/, '');
    
    const buffer = Buffer.from(base64Content, 'base64');
    const uploaded = await uploadBufferToObjectStorage({
      buffer,
      contentType: mimeType || 'application/octet-stream',
      originalName: filename,
      folder: `media/whatsapp/${waUserId}`,
      metadata: {
        source: 'whatsapp-webhook',
        waUserId,
        messageId,
      },
    });

    logger.info('Media saved from base64 to object storage', {
      waUserId,
      messageId,
      storageKey: uploaded.key,
      size: buffer.length,
    });

    return {
      internalUrl: uploaded.internalUrl,
      publicUrl: uploaded.url,
      storageKey: uploaded.key,
    };
  } catch (error: any) {
    logger.error('Failed to save base64 media', {
      error: error.message,
      waUserId,
      messageId,
    });
    return null;
  }
}

/**
 * Download media from WhatsApp via genfity-wa API
 * This uses the encrypted media download endpoints
 */
export async function downloadWhatsAppMedia(
  mediaMessage: GenfityMediaMessage,
  mediaType: 'image' | 'video' | 'audio' | 'document' | 'sticker',
  waUserId: string,
  messageId: string,
  villageId?: string
): Promise<SavedMediaResult | null> {
  try {
    const resolved = await getAccessTokenForVillage(villageId);
    const accessToken = resolved.token;
    if (!accessToken) {
      logger.warn('No WhatsApp session token available, cannot download media', {
        village_id: resolved.village_id,
        token_source: resolved.source,
      });
      return null;
    }

    const mediaUrl = getMediaField(mediaMessage, ['URL', 'Url', 'url']);
    if (!mediaUrl) {
      logger.warn('No media URL in message', { messageId });
      return null;
    }

    // Determine the correct endpoint based on media type
    const endpointMap: Record<string, string> = {
      image: '/chat/downloadimage',
      video: '/chat/downloadvideo',
      audio: '/chat/downloadaudio',
      document: '/chat/downloaddocument',
      sticker: '/chat/downloadsticker',
    };
    
    const endpoint = endpointMap[mediaType];
    if (!endpoint) {
      logger.warn('Unsupported media type for download', { mediaType });
      return null;
    }

    const mimeType = getMediaField(mediaMessage, ['Mimetype', 'mimetype', 'mimeType']) || 'application/octet-stream';

    // Build request body for media download
    const requestBody = {
      Url: mediaUrl,
      DirectPath: getMediaField(mediaMessage, ['DirectPath', 'directPath', 'direct_path']),
      MediaKey: getMediaField(mediaMessage, ['MediaKey', 'mediaKey', 'media_key']),
      Mimetype: mimeType,
      FileEncSHA256: getMediaField(mediaMessage, ['FileEncSHA256', 'FileEncSha256', 'fileEncSHA256', 'fileEncSha256', 'file_enc_sha256']),
      FileSHA256: getMediaField(mediaMessage, ['FileSHA256', 'FileSha256', 'fileSHA256', 'fileSha256', 'file_sha256']),
      FileLength: getMediaFileLength(mediaMessage),
    };

    logger.debug('Downloading media from WhatsApp', {
      gatewayEndpoint: endpoint,
      mediaType,
      messageId,
    });

    const responseData = await waGatewayRequest(accessToken, endpoint, 'POST', requestBody);

    // Response contains base64 encoded media
    const base64Data = responseData.data?.Data || responseData.Data || responseData.data?.Media || responseData.Media || responseData;
    const responseMimeType = responseData.data?.Mimetype || responseData.Mimetype || mimeType;

    if (!base64Data || typeof base64Data !== 'string') {
      logger.warn('No media data in download response', { messageId, response: responseData });
      return null;
    }

    // Save the downloaded media
    const savedResult = await saveBase64Media(
      base64Data,
      responseMimeType,
      waUserId,
      messageId
    );

    return savedResult;
  } catch (error: any) {
    logger.error('Failed to download WhatsApp media', {
      error: error.message,
      response: error.response?.data,
      mediaType,
      messageId,
    });
    return null;
  }
}

/**
 * Process media from webhook payload
 * Returns the final accessible URL for the media
 */
export async function processMediaFromWebhook(
  payload: GenfityWebhookPayload,
  waUserId: string,
  messageId: string,
  villageId?: string
): Promise<MediaInfo> {
  const mediaInfo = extractMediaInfo(payload);
  
  if (!mediaInfo.hasMedia) {
    return mediaInfo;
  }

  // If we already have a URL (from S3), use it directly
  if (mediaInfo.mediaUrl) {
    logger.info('Using S3 URL for media', {
      waUserId,
      messageId,
      mediaType: mediaInfo.mediaType,
      url: mediaInfo.mediaUrl,
    });
    if (villageId) {
      await logWaActivity({
        villageId,
        waUserId,
        type: 'media_s3_received',
        severity: 'info',
        status: 'ok',
        message: 'Media WhatsApp diterima melalui S3 tanpa base64.',
        providerMessageId: messageId,
        metadata: {
          mediaType: mediaInfo.mediaType,
          mimeType: mediaInfo.mimeType,
          storageKey: mediaInfo.storageKey,
          fileSize: mediaInfo.fileSize,
        },
      });
    }
    return mediaInfo;
  }

  // If we have base64 data in payload root, save it locally
  if (payload.base64) {
    const savedResult = await saveBase64Media(
      payload.base64,
      payload.mimeType || 'application/octet-stream',
      waUserId,
      messageId
    );
    
    if (savedResult) {
      if (villageId) {
        await logWaActivity({
          villageId,
          waUserId,
          type: 'media_base64_fallback',
          severity: 'warning',
          status: 'stored',
          message: 'Media WhatsApp diterima via base64 fallback dan disimpan ulang ke object storage.',
          providerMessageId: messageId,
          metadata: { mediaType: mediaInfo.mediaType, mimeType: payload.mimeType },
        });
      }
      return {
        ...mediaInfo,
        mediaUrl: savedResult.internalUrl,
        mediaPublicUrl: savedResult.publicUrl,
        storageKey: savedResult.storageKey,
      };
    }
  }

  // Try to extract and use JPEGThumbnail as fallback
  const msg = payload.event?.Message;
  if (msg && mediaInfo.mediaType === 'image') {
    const imgMsg = msg.ImageMessage || (msg as any).imageMessage;
    
    if (imgMsg?.JPEGThumbnail) {
      logger.info('Using JPEGThumbnail as fallback for image', {
        waUserId,
        messageId,
        thumbnailLength: imgMsg.JPEGThumbnail.length,
      });
      
      const savedResult = await saveBase64Media(
        imgMsg.JPEGThumbnail,
        'image/jpeg',
        waUserId,
        `${messageId}_thumb`
      );
      
      if (savedResult) {
        if (villageId) {
          await logWaActivity({
            villageId,
            waUserId,
            type: 'media_thumbnail_fallback',
            severity: 'warning',
            status: 'stored',
            message: 'Media WhatsApp memakai thumbnail fallback karena URL S3/media asli belum tersedia.',
            providerMessageId: messageId,
            metadata: { mediaType: mediaInfo.mediaType, mimeType: 'image/jpeg' },
          });
        }
        return {
          ...mediaInfo,
          mediaUrl: savedResult.internalUrl,
          mediaPublicUrl: savedResult.publicUrl,
          storageKey: savedResult.storageKey,
        };
      }
    }
  }

  // Otherwise, try to download from WhatsApp (may fail with HMAC error)
  if (msg && mediaInfo.mediaType) {
    let mediaMessage: GenfityMediaMessage | undefined;
    
    switch (mediaInfo.mediaType) {
      case 'image':
        mediaMessage = msg.ImageMessage || (msg as any).imageMessage;
        break;
      case 'video':
        mediaMessage = msg.VideoMessage || (msg as any).videoMessage;
        break;
      case 'audio':
        mediaMessage = msg.AudioMessage || (msg as any).audioMessage;
        break;
      case 'document':
        mediaMessage = msg.DocumentMessage || (msg as any).documentMessage;
        break;
      case 'sticker':
        mediaMessage = msg.StickerMessage || (msg as any).stickerMessage;
        break;
    }

    if (mediaMessage) {
      const downloadedResult = await downloadWhatsAppMedia(
        mediaMessage,
        mediaInfo.mediaType,
        waUserId,
        messageId,
        villageId
      );
      
      if (downloadedResult) {
        if (villageId) {
          await logWaActivity({
            villageId,
            waUserId,
            type: 'media_download_fallback',
            severity: 'warning',
            status: 'stored',
            message: 'Media WhatsApp dipulihkan via endpoint download fallback dan disimpan ke object storage.',
            providerMessageId: messageId,
            metadata: { mediaType: mediaInfo.mediaType, storageKey: downloadedResult.storageKey },
          });
        }
        return {
          ...mediaInfo,
          mediaUrl: downloadedResult.internalUrl,
          mediaPublicUrl: downloadedResult.publicUrl,
          storageKey: downloadedResult.storageKey,
        };
      }
    }
  }

  // Return media info without URL if download failed
  logger.warn('Could not obtain media URL', {
    waUserId,
    messageId,
    mediaType: mediaInfo.mediaType,
  });
  if (villageId) {
    await logWaActivity({
      villageId,
      waUserId,
      type: 'media_unavailable',
      severity: 'warning',
      status: 'missing_url',
      message: 'Media WhatsApp belum memiliki URL; gunakan retry download manual jika diperlukan.',
      providerMessageId: messageId,
      metadata: {
        mediaType: mediaInfo.mediaType,
        mediaError: (payload as any).media_error || null,
      },
    });
  }

  return mediaInfo;
}

