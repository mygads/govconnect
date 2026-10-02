import { Router, Request, Response } from 'express';
import multer from 'multer';
import crypto from 'crypto';
import path from 'path';
import { processDocumentBufferWithBilling } from '../services/document-ingest.service';
import { config } from '../config/env';
import { firstHeader, getParam } from '../utils/http';
import { deleteObjectByUrl, uploadBufferToObjectStorage } from '../services/object-storage.service';
import { internalApiKeyMatches } from '../utils/internal-auth';
import { clearRetrievalCache } from '../services/rag.service';
import logger from '../utils/logger';
import { deleteDocumentVectors } from '../services/vector-db.service';

const router = Router();

const allowedMimeTypes = new Set([
  'application/pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  'application/vnd.ms-powerpoint',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.ms-excel',
  'text/plain',
  'text/markdown',
  'text/x-markdown',
  'text/csv',
  'image/png',
  'image/jpeg',
  'image/webp',
  'image/tiff',
  'image/bmp',
  'application/octet-stream',
]);

const allowedExtensions = new Set([
  'pdf', 'docx', 'doc', 'pptx', 'ppt', 'txt', 'md', 'csv',
  'xls', 'xlsx', 'png', 'jpg', 'jpeg', 'webp', 'tif', 'tiff', 'bmp',
]);

function getExtension(filename?: string): string {
  return path.extname(filename || '').replace(/^\./, '').toLowerCase();
}

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const extension = getExtension(file.originalname);
    const mimeType = (file.mimetype || '').toLowerCase();
    const validExtension = allowedExtensions.has(extension);
    const validMime = !mimeType || allowedMimeTypes.has(mimeType);

    if (validExtension && validMime) {
      cb(null, true);
    } else {
      cb(new Error('File type not supported. Allowed: PDF, DOCX, DOC, PPT, PPTX, TXT, MD, CSV, XLS, XLSX, PNG, JPG, WEBP, TIFF, BMP'));
    }
  },
});

function verifyInternalKey(req: Request, res: Response, next: Function) {
  const apiKey = firstHeader(req.headers['x-internal-api-key']);
  if (!internalApiKeyMatches(apiKey)) return res.status(403).json({ error: 'Unauthorized' });
  next();
}

function documentIngestErrorCode(error: any): 'PARSE_FAIL' | 'EMBED_FAIL' {
  const message = String(error?.message || '').toLowerCase();
  if (
    message.includes('parse') ||
    message.includes('extractable text') ||
    message.includes('unsupported file') ||
    message.includes('corrupted') ||
    message.includes('password protected') ||
    message.includes('file appears') ||
    message.includes('office parser') ||
    message.includes('contains no extractable text')
  ) {
    return 'PARSE_FAIL';
  }
  return 'EMBED_FAIL';
}

router.post('/document', verifyInternalKey, upload.single('file'), async (req: Request, res: Response) => {
  const file = req.file;
  const { documentId, title, category, village_id, villageId, fileHash, upload_only, scope, is_global, isGlobal } = req.body;
  const isGlobalDocument = scope === 'global' || is_global === 'true' || isGlobal === 'true' || is_global === true || isGlobal === true;
  const resolvedVillageId: string | null = isGlobalDocument
    ? null
    : typeof village_id === 'string' && village_id.length > 0
      ? village_id
      : typeof villageId === 'string' && villageId.length > 0
        ? villageId
        : null;

  if (!file) return res.status(400).json({ error: 'No file provided' });
  if (!documentId) return res.status(400).json({ error: 'documentId is required' });

  const computedFileHash = crypto.createHash('sha256').update(file.buffer).digest('hex');
  if (typeof fileHash === 'string' && fileHash.length > 0 && fileHash !== computedFileHash) {
    return res.status(400).json({ error: 'fileHash does not match uploaded file' });
  }

  const storageFolder = resolvedVillageId
    ? `villages/${resolvedVillageId}/knowledge/documents/${documentId}`
    : `knowledge/documents/${documentId}`;

  try {
    const storedFile = await uploadBufferToObjectStorage({
      buffer: file.buffer,
      contentType: file.mimetype || 'application/octet-stream',
      originalName: file.originalname,
      folder: storageFolder,
      metadata: { documentId, villageId: resolvedVillageId || '' },
    });

    if (upload_only === 'true') {
      return res.json({
        success: true,
        documentId,
        filename: storedFile.fileName,
        fileUrl: storedFile.url,
        fileKey: storedFile.key,
        originalName: file.originalname,
        fileSize: file.size,
        mimeType: file.mimetype,
        uploadOnly: true,
        message: 'Document uploaded successfully',
      });
    }

    const result = await processDocumentBufferWithBilling({
      documentId,
      fileBuffer: file.buffer,
      originalName: file.originalname,
      mimeType: file.mimetype,
      title,
      category,
      villageId: resolvedVillageId,
      isGlobal: isGlobalDocument,
      fileHash: computedFileHash,
      tracePrefix: 'document',
    });

    clearRetrievalCache(resolvedVillageId);

    // R3: surface KB-router rejections to the uploader. The document row
    // already carries status 'rejected' with the reason.
    const kbRoute = (result as { kbRoute?: string }).kbRoute;
    const kbRejected = kbRoute === 'rejected';
    return res.json({
      success: !kbRejected,
      documentId,
      filename: storedFile.fileName,
      fileUrl: storedFile.url,
      fileKey: storedFile.key,
      originalName: file.originalname,
      fileSize: file.size,
      mimeType: file.mimetype,
      chunksCount: result.chunksCount,
      aiChunking: result.usedAiChunking,
      ocrQueued: Boolean((result as any).queuedOcr),
      kbRoute,
      rejected: kbRejected || undefined,
      message: kbRejected
        ? 'Dokumen DITOLAK oleh KB router: berisi data operasional yang sudah otoritatif di sistem (jam layanan/tarif/kontak). Data ini dikelola di case-service. Update di sana.'
        : (result as any).queuedOcr ? 'Document queued for OCR processing' : 'Document uploaded and processed successfully',
    });
  } catch (error: any) {
    logger.error('Document upload failed', { documentId, error: error.message });
    return res.status(500).json({ error: 'Document upload failed', code: documentIngestErrorCode(error), details: error.message });
  }
});

router.post('/document/:documentId/process', verifyInternalKey, async (req: Request, res: Response) => {
  const documentId = getParam(req, 'documentId');
  if (!documentId) return res.status(400).json({ error: 'documentId is required' });

  try {
    const response = await fetch(`${config.dashboardServiceUrl}/api/internal/documents/${documentId}`, {
      headers: { 'x-internal-api-key': config.internalApiKey },
      signal: AbortSignal.timeout(15000),
    });
    if (!response.ok) return res.status(404).json({ error: 'Document not found' });

    const payload = await response.json() as { data?: { id: string; title?: string | null; category?: string | null; village_id?: string | null; scope?: string | null; is_global?: boolean | null; file_url?: string | null; original_name?: string | null; mime_type?: string | null } };
    const document = payload?.data;
    if (!document?.file_url) return res.status(400).json({ error: 'Document file is not available' });

    const fileRes = await fetch(document.file_url, { signal: AbortSignal.timeout(30000) });
    if (!fileRes.ok) return res.status(502).json({ error: 'Failed to download document file for processing' });

    const buffer = Buffer.from(await fileRes.arrayBuffer());
    const bufferHash = crypto.createHash('sha256').update(buffer).digest('hex');
    const result = await processDocumentBufferWithBilling({
      documentId,
      fileBuffer: buffer,
      originalName: document.original_name || `document-${documentId}`,
      mimeType: document.mime_type || fileRes.headers.get('content-type') || 'application/octet-stream',
      title: document.title || undefined,
      category: document.category || undefined,
      villageId: document.is_global || document.scope === 'global' ? null : document.village_id || null,
      isGlobal: Boolean(document.is_global || document.scope === 'global'),
      fileHash: bufferHash,
      tracePrefix: 'document-reprocess',
    });

    clearRetrievalCache(document.village_id || null);

    // R3: surface KB-router rejections (document row already 'rejected').
    const kbRoute = (result as { kbRoute?: string }).kbRoute;
    const kbRejected = kbRoute === 'rejected';
    return res.json({
      success: !kbRejected,
      documentId,
      chunksCount: result.chunksCount,
      aiChunking: result.usedAiChunking,
      ocrQueued: Boolean((result as any).queuedOcr),
      kbRoute,
      rejected: kbRejected || undefined,
      message: kbRejected
        ? 'Dokumen DITOLAK oleh KB router: berisi data operasional yang sudah otoritatif di sistem (jam layanan/tarif/kontak). Data ini dikelola di case-service. Update di sana.'
        : (result as any).queuedOcr ? 'Document queued for OCR processing' : 'Document processed successfully',
    });
  } catch (error: any) {
    logger.error('Document process failed', { documentId, error: error.message });
    return res.status(500).json({ error: 'Document process failed', code: documentIngestErrorCode(error), details: error.message });
  }
});

router.delete('/document/:documentId', verifyInternalKey, async (req: Request, res: Response) => {
  const documentId = getParam(req, 'documentId');
  if (!documentId) return res.status(400).json({ error: 'documentId is required' });

  try {
    let deletedFile = false;
    try {
      const response = await fetch(`${config.dashboardServiceUrl}/api/internal/documents/${documentId}`, {
        headers: { 'x-internal-api-key': config.internalApiKey },
        signal: AbortSignal.timeout(15000),
      });
      if (response.ok) {
        const payload = await response.json() as { data?: { file_url?: string | null } };
        deletedFile = await deleteObjectByUrl(payload?.data?.file_url).catch(() => false);
      }
    } catch (storageError: any) {
      logger.warn('Failed to inspect/delete document object storage file', { documentId, error: storageError.message });
    }

    await deleteDocumentVectors(documentId);
    clearRetrievalCache();
    return res.json({ success: true, message: deletedFile ? 'Document vectors and stored file deleted successfully' : 'Document vectors deleted successfully' });
  } catch (error: any) {
    logger.error('Failed to delete document vectors', { documentId, error: error.message });
    return res.status(500).json({ error: 'Failed to delete document', details: error.message });
  }
});

/**
 * POST /api/upload/document/:documentId/process-seed
 * Process a seeded document (content already in dashboard DB, no file download).
 * Fetches chunks from dashboard, generates embeddings, stores in AI service.
 */
router.post('/document/:documentId/process-seed', verifyInternalKey, async (req: Request, res: Response) => {
  const documentId = getParam(req, 'documentId');
  if (!documentId) return res.status(400).json({ error: 'documentId is required' });

  try {
    // 1. Fetch document + chunks from dashboard
    const docRes = await fetch(`${config.dashboardServiceUrl}/api/internal/documents/${documentId}`, {
      headers: { 'x-internal-api-key': config.internalApiKey },
      signal: AbortSignal.timeout(15000),
    });
    if (!docRes.ok) return res.status(404).json({ error: 'Document not found in dashboard' });

    const docPayload = await docRes.json() as { data?: { id: string; title?: string; village_id?: string } };
    const doc = docPayload?.data;
    if (!doc) return res.status(404).json({ error: 'Document data not found' });

    const chunksRes = await fetch(`${config.dashboardServiceUrl}/api/internal/documents/${documentId}/chunks`, {
      headers: { 'x-internal-api-key': config.internalApiKey },
      signal: AbortSignal.timeout(15000),
    });
    if (!chunksRes.ok) return res.status(404).json({ error: 'Document chunks not found' });

    const chunksPayload = await chunksRes.json() as { chunks?: Array<{ chunk_index: number; content: string }>; total?: number };
    const chunks = chunksPayload?.chunks || [];
    if (chunks.length === 0) return res.status(400).json({ error: 'No chunks found for document' });

    // 2. Generate embeddings
    const { generateBatchEmbeddings } = await import('../services/embedding.service');
    const texts = chunks.map(c => c.content);
    const batchResult = await generateBatchEmbeddings(texts);
    const embeddings = batchResult.embeddings.map(e => e.values);

    // 3. Store in document_vectors
    const { default: prisma } = await import('../lib/prisma');
    const villageId = doc.village_id || null;
    let stored = 0;

    for (let i = 0; i < chunks.length; i++) {
      const chunk = chunks[i];
      const embedding = embeddings[i];
      if (!embedding) continue;

      await prisma.$executeRawUnsafe(
        `INSERT INTO ai.document_vectors (id, document_id, village_id, chunk_index, content, embedding, created_at)
         VALUES (gen_random_uuid(), $1, $2, $3, $4, $5::ai.vector, NOW())
         ON CONFLICT (document_id, chunk_index) DO UPDATE SET
           content = EXCLUDED.content,
           embedding = EXCLUDED.embedding,
           created_at = NOW()`,
        documentId, villageId, chunk.chunk_index, chunk.content, `[${embedding.join(',')}]`
      );
      stored++;
    }

    // 4. Update dashboard status
    try {
      await fetch(`${config.dashboardServiceUrl}/api/internal/documents/${documentId}/status`, {
        method: 'PUT',
        headers: {
          'x-internal-api-key': config.internalApiKey,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ status: 'completed' }),
        signal: AbortSignal.timeout(10000),
      });
    } catch (e) {
      logger.warn('Failed to update dashboard document status', { documentId });
    }

    clearRetrievalCache(villageId);
    return res.json({
      success: true,
      documentId,
      chunksCount: chunks.length,
      stored,
      message: 'Seeded document processed successfully',
    });
  } catch (error: any) {
    logger.error('Seed document process failed', { documentId, error: error.message });
    return res.status(500).json({ error: 'Failed to process seed document', details: error.message });
  }
});

export default router;
