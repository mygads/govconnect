import axios from 'axios';
import fs from 'fs';
import path from 'path';
import logger from '../utils/logger';
import { config } from '../config/env';
import { GenfityWebhookPayload, GenfityMediaMessage } from '../types/webhook.types';

// Storage configuration
const MEDIA_STORAGE_PATH = process.env.MEDIA_STORAGE_PATH || '/app/uploads';
// Internal URL for Docker network (used by other services)
const MEDIA_INTERNAL_URL = process.env.MEDIA_INTERNAL_URL || 'http://channel-service:3001/uploads';
// Public URL for browser access (used by Dashboard)
const MEDIA_PUBLIC_URL = process.env.MEDIA_PUBLIC_URL || 'http://localhost:3001/uploads';

export interface MediaInfo {
  hasMedia: boolean;
  mediaType?: 'image' | 'video' | 'audio' | 'document' | 'sticker';
  mediaUrl?: string;           // Internal URL for Docker network (Case Service)
  mediaPublicUrl?: string;     // Public URL for browser access (Dashboard)
  mimeType?: string;
  fileName?: string;
  caption?: string;
  fileSize?: number;
  localPath?: string;          // Local file path if downloaded
}

export interface DownloadMediaParams {
  url: string;
  mediaKey: string;
  mimetype: string;
  fileSha256: string;
  fileLength: number;
  fileEncSha256?: string;
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
      mimeType: payload.s3.mimeType,
      fileName: payload.s3.fileName,
      fileSize: payload.s3.size,
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
  localPath: string;    // Local file path
}

/**
 * Save base64 media to local storage
 */
export async function saveBase64Media(
  base64Data: string,
  mimeType: string,
  waUserId: string,
  messageId: string
): Promise<SavedMediaResult | null> {
  try {
    // Ensure storage directory exists
    const userDir = path.join(MEDIA_STORAGE_PATH, waUserId);
    if (!fs.existsSync(userDir)) {
      fs.mkdirSync(userDir, { recursive: true });
    }

    // Generate filename
    const ext = getExtensionFromMime(mimeType);
    const filename = `${messageId}_${Date.now()}.${ext}`;
    const filePath = path.join(userDir, filename);

    // Remove data URL prefix if present
    const base64Content = base64Data.replace(/^data:[^;]+;base64,/, '');
    
    // Save file
    const buffer = Buffer.from(base64Content, 'base64');
    fs.writeFileSync(filePath, buffer);

    logger.info('Media saved from base64', {
      waUserId,
      messageId,
      filePath,
      size: buffer.length,
    });

    // Return both internal and public URLs
    const relativePath = `${waUserId}/${filename}`;
    return {
      internalUrl: `${MEDIA_INTERNAL_URL}/${relativePath}`,
      publicUrl: `${MEDIA_PUBLIC_URL}/${relativePath}`,
      localPath: filePath,
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
  mediaType: 'image' | 'video' | 'audio' | 'document',
  waUserId: string,
  messageId: string
): Promise<SavedMediaResult | null> {
  try {
    if (!config.WA_ACCESS_TOKEN) {
      logger.warn('WA_ACCESS_TOKEN not configured, cannot download media');
      return null;
    }

    if (!mediaMessage.URL) {
      logger.warn('No media URL in message', { messageId });
      return null;
    }

    // Determine the correct endpoint based on media type
    const endpointMap: Record<string, string> = {
      image: '/chat/downloadimage',
      video: '/chat/downloadvideo',
      audio: '/chat/downloadaudio',
      document: '/chat/downloaddocument',
    };
    
    const endpoint = endpointMap[mediaType];
    if (!endpoint) {
      logger.warn('Unsupported media type for download', { mediaType });
      return null;
    }

    const url = `${config.WA_API_URL}${endpoint}`;
    
    // Build request body for media download
    const requestBody = {
      Url: mediaMessage.URL,
      MediaKey: '', // Will be filled if available
      Mimetype: mediaMessage.Mimetype || '',
      FileSHA256: mediaMessage.FileSHA256 || '',
      FileLength: mediaMessage.FileLength || 0,
    };

    logger.debug('Downloading media from WhatsApp', {
      url,
      mediaType,
      messageId,
    });

    const response = await axios.post(url, requestBody, {
      headers: {
        token: config.WA_ACCESS_TOKEN,
        'Content-Type': 'application/json',
      },
      timeout: 60000, // 60 seconds for media download
    });

    // Response contains base64 encoded media
    const base64Data = response.data.data?.Media || response.data.Media || response.data;
    
    if (!base64Data || typeof base64Data !== 'string') {
      logger.warn('No media data in download response', { messageId });
      return null;
    }

    // Save the downloaded media
    const savedResult = await saveBase64Media(
      base64Data,
      mediaMessage.Mimetype || 'application/octet-stream',
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
  messageId: string
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
      return {
        ...mediaInfo,
        mediaUrl: savedResult.internalUrl,
        mediaPublicUrl: savedResult.publicUrl,
        localPath: savedResult.localPath,
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
        return {
          ...mediaInfo,
          mediaUrl: savedResult.internalUrl,
          mediaPublicUrl: savedResult.publicUrl,
          localPath: savedResult.localPath,
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
    }

    if (mediaMessage && mediaInfo.mediaType !== 'sticker') {
      const downloadedResult = await downloadWhatsAppMedia(
        mediaMessage,
        mediaInfo.mediaType,
        waUserId,
        messageId
      );
      
      if (downloadedResult) {
        return {
          ...mediaInfo,
          mediaUrl: downloadedResult.internalUrl,
          mediaPublicUrl: downloadedResult.publicUrl,
          localPath: downloadedResult.localPath,
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
  
  return mediaInfo;
}

/**
 * Ensure media storage directory exists
 */
export function ensureStorageDirectory(): void {
  if (!fs.existsSync(MEDIA_STORAGE_PATH)) {
    fs.mkdirSync(MEDIA_STORAGE_PATH, { recursive: true });
    logger.info('Created media storage directory', { path: MEDIA_STORAGE_PATH });
  }
}

// Initialize storage directory on module load
ensureStorageDirectory();
