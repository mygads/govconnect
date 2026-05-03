import { Router, Request, Response } from 'express';
import multer from 'multer';
import crypto from 'crypto';
import { processDocumentBufferWithBilling } from '../services/document-ingest.service';
import { config } from '../config/env';
import { firstHeader, getParam } from '../utils/http';
import { deleteObjectByUrl, uploadBufferToObjectStorage } from '../services/object-storage.service';
import { internalApiKeyMatches } from '../utils/internal-auth';
import { clearRetrievalCache } from '../services/rag.service';
import logger from '../utils/logger';
import { deleteDocumentVectors } from '../services/vector-db.service';

const router = Router();

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const allowedTypes = [
      'application/pdf',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'application/msword',
      'application/vnd.openxmlformats-officedocument.presentationml.presentation',
      'application/vnd.ms-powerpoint',
      'text/plain',
      'text/markdown',
      'text/csv',
    ];
    if (allowedTypes.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error('File type not supported. Allowed: PDF, DOCX, DOC, PPT, PPTX, TXT, MD, CSV'));
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

    return res.json({
      success: true,
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
      message: (result as any).queuedOcr ? 'Document queued for OCR processing' : 'Document uploaded and processed successfully',
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

    return res.json({
      success: true,
      documentId,
      chunksCount: result.chunksCount,
      aiChunking: result.usedAiChunking,
      ocrQueued: Boolean((result as any).queuedOcr),
      message: (result as any).queuedOcr ? 'Document queued for OCR processing' : 'Document processed successfully',
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

export default router;
