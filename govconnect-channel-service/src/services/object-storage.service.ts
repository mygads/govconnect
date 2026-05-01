import crypto from 'crypto';
import path from 'path';
import { ListObjectsV2Command, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import logger from '../utils/logger';

interface UploadBufferParams {
  buffer: Buffer;
  contentType: string;
  originalName?: string;
  folder: string;
  cacheControl?: string;
  metadata?: Record<string, string>;
}

export interface StoredObjectResult {
  bucket: string;
  key: string;
  fileName: string;
  url: string;
  internalUrl: string;
}

export interface WhatsAppSessionS3Config {
  enabled: boolean;
  endpoint: string;
  region: string;
  bucket: string;
  access_key: string;
  secret_key: string;
  path_style: boolean;
  public_url: string;
  media_delivery: string;
  retention_days: number;
}

export interface ObjectStorageHealth {
  configured: boolean;
  connected: boolean | null;
  status: 'connected' | 'error' | 'not_configured';
  provider: string | null;
  endpoint: string | null;
  region: string | null;
  bucket: string | null;
  publicUrl: string | null;
  pathStyle: boolean;
  usageBytes: number | null;
  usageMb: number | null;
  error: string | null;
}

function normalizeBaseUrl(value: string | undefined): string {
  return (value || '').trim().replace(/\/+$/, '');
}

function sanitizeErrorMessage(error: any): string {
  let message = error?.message || String(error || 'Unknown object storage error');
  for (const secret of [storageAccessKey, storageSecretKey]) {
    if (secret) message = message.split(secret).join('[redacted]');
  }
  return message.slice(0, 500);
}

function isR2Endpoint(endpoint: string): boolean {
  return /\.r2\.cloudflarestorage\.com$/i.test(endpoint.replace(/^https?:\/\//i, ''));
}

function resolveRegion(endpoint: string, configuredRegion: string): string {
  if (isR2Endpoint(endpoint)) {
    return 'auto';
  }

  return configuredRegion || 'us-east-1';
}

function sanitizeSegment(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9/_-]+/g, '-')
    .replace(/\/+/g, '/')
    .replace(/^-+|-+$/g, '')
    .replace(/\/$/, '');
}

function sanitizeFileName(originalName: string | undefined, fallbackExt: string): string {
  const raw = path.basename(originalName || `file${fallbackExt}`);
  const ext = path.extname(raw).toLowerCase() || fallbackExt;
  const base = path.basename(raw, path.extname(raw))
    .toLowerCase()
    .replace(/[^a-z0-9-_]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);

  return `${base || 'file'}${ext}`;
}

function inferExtension(contentType: string): string {
  switch ((contentType || '').toLowerCase()) {
    case 'image/jpeg':
    case 'image/jpg':
      return '.jpg';
    case 'image/png':
      return '.png';
    case 'image/gif':
      return '.gif';
    case 'image/webp':
      return '.webp';
    case 'video/mp4':
      return '.mp4';
    case 'video/3gpp':
      return '.3gp';
    case 'audio/ogg':
      return '.ogg';
    case 'audio/mpeg':
      return '.mp3';
    case 'audio/mp4':
      return '.m4a';
    case 'application/pdf':
      return '.pdf';
    case 'application/msword':
      return '.doc';
    case 'application/vnd.openxmlformats-officedocument.wordprocessingml.document':
      return '.docx';
    default:
      return '';
  }
}

function encodeObjectKey(key: string): string {
  return key.split('/').map(segment => encodeURIComponent(segment)).join('/');
}

const storageEndpoint = normalizeBaseUrl(process.env.S3_ENDPOINT);
const storageBucket = (process.env.S3_BUCKET || '').trim();
const storageAccessKey = (process.env.S3_ACCESS_KEY || '').trim();
const storageSecretKey = (process.env.S3_SECRET_KEY || '').trim();
const storagePublicUrl = normalizeBaseUrl(process.env.S3_PUBLIC_URL);
const storageDelivery = (process.env.S3_MEDIA_DELIVERY || 's3').trim().toLowerCase();
const storageRegion = resolveRegion(storageEndpoint, (process.env.S3_REGION || '').trim());
const storagePathStyle = process.env.S3_PATH_STYLE === 'true';
const storageRetentionDays = Math.max(1, parseInt(process.env.S3_RETENTION_DAYS || '365', 10) || 365);
const storageEnabled =
  storageDelivery === 's3' &&
  storageEndpoint.length > 0 &&
  storageBucket.length > 0 &&
  storageAccessKey.length > 0 &&
  storageSecretKey.length > 0;

const s3Client = storageEnabled
  ? new S3Client({
      region: storageRegion,
      endpoint: storageEndpoint,
      credentials: {
        accessKeyId: storageAccessKey,
        secretAccessKey: storageSecretKey,
      },
      forcePathStyle: storagePathStyle,
      maxAttempts: 3,
    })
  : null;

function ensureConfigured(): void {
  if (!storageEnabled || !s3Client) {
    throw new Error('S3 storage is not configured. Set S3_ENDPOINT, S3_BUCKET, S3_ACCESS_KEY, S3_SECRET_KEY, and S3_PUBLIC_URL.');
  }
}

function buildPublicUrl(key: string): string {
  if (storagePublicUrl) {
    return `${storagePublicUrl}/${encodeObjectKey(key)}`;
  }

  return `${storageEndpoint}/${storageBucket}/${encodeObjectKey(key)}`;
}

function buildObjectKey(folder: string, originalName?: string, contentType?: string): { key: string; fileName: string } {
  const fallbackExt = inferExtension(contentType || '');
  const safeFolder = sanitizeSegment(folder) || 'uploads';
  const safeFileName = sanitizeFileName(originalName, fallbackExt);
  const generatedFileName = `${Date.now()}-${crypto.randomUUID()}-${safeFileName}`;
  const key = `${safeFolder}/${generatedFileName}`.replace(/\/+/g, '/');

  return {
    key,
    fileName: generatedFileName,
  };
}

function normalizeMetadata(metadata?: Record<string, string>): Record<string, string> | undefined {
  if (!metadata) return undefined;

  const entries = Object.entries(metadata)
    .filter(([, value]) => typeof value === 'string' && value.trim().length > 0)
    .map(([key, value]) => [key, value.trim()]);

  if (entries.length === 0) {
    return undefined;
  }

  return Object.fromEntries(entries);
}

export function isObjectStorageEnabled(): boolean {
  return storageEnabled;
}

export function getObjectStorageInfo() {
  return {
    enabled: storageEnabled,
    delivery: storageDelivery,
    provider: isR2Endpoint(storageEndpoint) ? 'cloudflare-r2' : 's3-compatible',
    endpoint: storageEndpoint || null,
    region: storageRegion || null,
    bucket: storageBucket || null,
    publicUrl: storagePublicUrl || null,
    pathStyle: storagePathStyle,
  };
}

export function getWhatsAppSessionS3Config(): WhatsAppSessionS3Config | null {
  if (!storageEnabled) {
    return null;
  }

  return {
    enabled: true,
    endpoint: storageEndpoint,
    region: storageRegion,
    bucket: storageBucket,
    access_key: storageAccessKey,
    secret_key: storageSecretKey,
    path_style: storagePathStyle,
    public_url: storagePublicUrl,
    media_delivery: storageDelivery,
    retention_days: storageRetentionDays,
  };
}

export async function checkObjectStorageHealth(options: { includeUsage?: boolean } = {}): Promise<ObjectStorageHealth> {
  const info = getObjectStorageInfo();
  const base: ObjectStorageHealth = {
    configured: storageEnabled,
    connected: storageEnabled ? false : null,
    status: storageEnabled ? 'error' : 'not_configured',
    provider: info.provider,
    endpoint: info.endpoint,
    region: info.region,
    bucket: info.bucket,
    publicUrl: info.publicUrl,
    pathStyle: info.pathStyle,
    usageBytes: null,
    usageMb: null,
    error: null,
  };

  if (!storageEnabled || !s3Client) {
    return base;
  }

  try {
    let usageBytes = 0;
    let continuationToken: string | undefined;

    do {
      const result = await s3Client.send(
        new ListObjectsV2Command({
          Bucket: storageBucket,
          MaxKeys: options.includeUsage ? 1000 : 1,
          ContinuationToken: continuationToken,
        }),
      );

      if (options.includeUsage) {
        usageBytes += (result.Contents || []).reduce((total, item) => total + (item.Size || 0), 0);
        continuationToken = result.IsTruncated ? result.NextContinuationToken : undefined;
      } else {
        continuationToken = undefined;
      }
    } while (continuationToken);

    return {
      ...base,
      connected: true,
      status: 'connected',
      usageBytes: options.includeUsage ? usageBytes : null,
      usageMb: options.includeUsage ? Number((usageBytes / 1024 / 1024).toFixed(2)) : null,
    };
  } catch (error: any) {
    logger.warn('Object storage health check failed', { error: error.message, bucket: storageBucket });
    return {
      ...base,
      error: sanitizeErrorMessage(error),
    };
  }
}

export async function uploadBufferToObjectStorage(params: UploadBufferParams): Promise<StoredObjectResult> {
  ensureConfigured();

  const { key, fileName } = buildObjectKey(params.folder, params.originalName, params.contentType);

  await s3Client!.send(
    new PutObjectCommand({
      Bucket: storageBucket,
      Key: key,
      Body: params.buffer,
      ContentType: params.contentType || 'application/octet-stream',
      CacheControl: params.cacheControl || 'public, max-age=31536000, immutable',
      Metadata: normalizeMetadata(params.metadata),
    }),
  );

  const url = buildPublicUrl(key);

  logger.info('Uploaded object to S3 storage', {
    bucket: storageBucket,
    key,
    size: params.buffer.length,
    contentType: params.contentType,
  });

  return {
    bucket: storageBucket,
    key,
    fileName,
    url,
    internalUrl: url,
  };
}
