import crypto from 'crypto';
import path from 'path';
import { DeleteObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
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

function normalizeBaseUrl(value: string | undefined): string {
  return (value || '').trim().replace(/\/+$/, '');
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

function inferExtension(contentType: string): string {
  switch ((contentType || '').toLowerCase()) {
    case 'application/pdf':
      return '.pdf';
    case 'application/msword':
      return '.doc';
    case 'application/vnd.openxmlformats-officedocument.wordprocessingml.document':
      return '.docx';
    case 'application/vnd.ms-powerpoint':
      return '.ppt';
    case 'application/vnd.openxmlformats-officedocument.presentationml.presentation':
      return '.pptx';
    case 'text/plain':
      return '.txt';
    case 'text/markdown':
      return '.md';
    case 'text/csv':
      return '.csv';
    default:
      return '';
  }
}

function sanitizeFileName(originalName: string | undefined, fallbackExt: string): string {
  const raw = path.basename(originalName || `document${fallbackExt}`);
  const ext = path.extname(raw).toLowerCase() || fallbackExt;
  const base = path.basename(raw, path.extname(raw))
    .toLowerCase()
    .replace(/[^a-z0-9-_]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);

  return `${base || 'document'}${ext}`;
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
  const safeFolder = sanitizeSegment(folder) || 'documents';
  const safeFileName = sanitizeFileName(originalName, inferExtension(contentType || ''));
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

function deriveKeyFromUrl(url: string): string | null {
  const normalizedUrl = (url || '').trim();
  if (!normalizedUrl) return null;

  if (storagePublicUrl && normalizedUrl.startsWith(`${storagePublicUrl}/`)) {
    return decodeURIComponent(normalizedUrl.slice(storagePublicUrl.length + 1));
  }

  const fallbackPrefix = `${storageEndpoint}/${storageBucket}/`;
  if (normalizedUrl.startsWith(fallbackPrefix)) {
    return decodeURIComponent(normalizedUrl.slice(fallbackPrefix.length));
  }

  return null;
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

  logger.info('Uploaded document to object storage', {
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

export async function deleteObjectByUrl(url: string | null | undefined): Promise<boolean> {
  const key = deriveKeyFromUrl(url || '');
  if (!key) {
    return false;
  }

  ensureConfigured();

  await s3Client!.send(
    new DeleteObjectCommand({
      Bucket: storageBucket,
      Key: key,
    }),
  );

  logger.info('Deleted object from S3 storage', {
    bucket: storageBucket,
    key,
  });

  return true;
}
