import os from 'os';
import path from 'path';
import fs from 'fs/promises';
import crypto from 'crypto';
import prisma from '../lib/prisma';
import logger from '../utils/logger';
import { config } from '../config/env';
import { registerInterval } from '../utils/timer-registry';
import { processDocumentSemanticChunking } from './document-processor.service';
import { smartChunkDocument } from './ai-chunking.service';
import { generateBatchEmbeddings } from './embedding.service';
import { addDocumentChunks, deleteDocumentVectors } from './vector-db.service';
import { withAiBillingTurn } from './ai-turn-billing.service';

export interface ProcessDocumentInput {
  documentId: string;
  fileBuffer: Buffer;
  originalName: string;
  mimeType: string;
  title?: string;
  category?: string;
  villageId?: string | null;
  isGlobal?: boolean;
  fileHash?: string | null;
  tracePrefix?: 'document' | 'document-reprocess' | 'document-ocr';
}

class ScannedDocumentError extends Error {
  constructor(message = 'PDF contains no extractable text. OCR is required.') {
    super(message);
    this.name = 'ScannedDocumentError';
  }
}

function isScannedPdfError(error: any): boolean {
  const message = String(error?.message || '').toLowerCase();
  return message.includes('no extractable text') || message.includes('scanned') || message.includes('image-based');
}

async function createTempUploadFile(input: { buffer: Buffer; originalName?: string }): Promise<{ filePath: string; cleanup: () => Promise<void> }> {
  const safeExt = path.extname(input.originalName || '').toLowerCase().slice(0, 10);
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'govconnect-ai-upload-'));
  const filePath = path.join(tempDir, `document${safeExt}`);
  await fs.writeFile(filePath, input.buffer);
  return {
    filePath,
    cleanup: async () => {
      await fs.rm(tempDir, { recursive: true, force: true }).catch(() => {});
    },
  };
}

function formatDelimitedTableText(text: string): string {
  const lines = text.split(/\r?\n/).map(line => line.trim()).filter(Boolean);
  if (lines.length < 2) return text;
  const delimiter = lines[0].includes('\t') ? '\t' : ',';
  const rows = lines.map(line => line.split(delimiter).map(cell => cell.trim().replace(/^"|"$/g, '')));
  const columnCount = Math.max(...rows.map(row => row.length));
  if (columnCount < 2) return text;
  return rows.map((row, idx) => `${idx === 0 ? 'Header' : `Row ${idx}`}: ${row.join(' | ')}`).join('\n');
}

function extractPdfPageText(page: any, pageNumber: number): string {
  const items = (page.content || [])
    .filter((item: any) => item.str && item.str.trim())
    .map((item: any) => ({ text: String(item.str).trim(), x: Number(item.x || 0), y: Number(item.y || 0) }))
    .sort((a: any, b: any) => Math.abs(a.y - b.y) > 2 ? b.y - a.y : a.x - b.x);

  const rows: Array<{ y: number; cells: Array<{ text: string; x: number }> }> = [];
  for (const item of items) {
    const row = rows.find(candidate => Math.abs(candidate.y - item.y) <= 2);
    if (row) {
      row.cells.push({ text: item.text, x: item.x });
    } else {
      rows.push({ y: item.y, cells: [{ text: item.text, x: item.x }] });
    }
  }

  return rows.map((row, idx) => {
    const cells = row.cells.sort((a, b) => a.x - b.x).map(cell => cell.text);
    const separator = cells.length > 2 ? ' | ' : ' ';
    return `${cells.length > 2 ? `Tabel/Baris ${pageNumber}.${idx + 1}: ` : ''}${cells.join(separator)}`;
  }).join('\n');
}

async function parseFileContent(filePath: string, mimeType: string): Promise<string> {
  if (mimeType === 'text/plain' || mimeType === 'text/markdown') {
    return await fs.readFile(filePath, 'utf-8');
  }

  if (mimeType === 'text/csv') {
    return formatDelimitedTableText(await fs.readFile(filePath, 'utf-8'));
  }

  if (mimeType === 'application/pdf') {
    try {
      const { PDFExtract } = await import('pdf.js-extract');
      const pdfExtract = new PDFExtract();
      const data = await pdfExtract.extract(filePath, {});
      let fullText = '';
      for (const [idx, page] of data.pages.entries()) {
        fullText += extractPdfPageText(page, idx + 1) + '\n\n';
      }
      fullText = fullText.trim();
      if (!fullText) throw new ScannedDocumentError('PDF contains no extractable text. It may be scanned/image-based.');
      return fullText;
    } catch (pdfError: any) {
      if (pdfError instanceof ScannedDocumentError) throw pdfError;
      if (pdfError.message?.includes('Invalid PDF structure') || pdfError.message?.includes('Invalid')) {
        throw new Error('PDF file appears to be corrupted or uses an unsupported format.');
      }
      if (pdfError.message?.includes('password')) {
        throw new Error('PDF is password protected. Please remove the password and try again.');
      }
      throw new Error(`Failed to parse PDF: ${pdfError.message}`);
    }
  }

  if (mimeType.includes('wordprocessingml')) {
    const mammoth = await import('mammoth');
    const result = await mammoth.extractRawText({ path: filePath });
    if (!result.value?.trim()) throw new Error('DOCX contains no extractable text.');
    return result.value;
  }

  if (mimeType === 'application/msword') {
    const WordExtractor = (await import('word-extractor')).default;
    const extractor = new WordExtractor();
    const doc = await extractor.extract(filePath);
    const extractedText = doc.getBody()?.trim() || '';
    if (!extractedText) throw new Error('DOC contains no extractable text.');
    return extractedText;
  }

  if (mimeType === 'application/vnd.openxmlformats-officedocument.presentationml.presentation') {
    const officeParser: any = await import('officeparser');
    const parseOfficeAsync = officeParser.parseOfficeAsync || officeParser.default?.parseOfficeAsync || officeParser.parseOffice;
    if (!parseOfficeAsync) throw new Error('Office parser not available');
    const result = await parseOfficeAsync(filePath);
    const text = typeof result === 'string' ? result : result?.text || '';
    if (!text.trim()) throw new Error('PPTX contains no extractable text.');
    return text;
  }

  if (mimeType === 'application/vnd.ms-powerpoint') {
    const officeParser: any = await import('officeparser');
    const parseOfficeAsync = officeParser.parseOfficeAsync || officeParser.default?.parseOfficeAsync;
    if (!parseOfficeAsync) throw new Error('Legacy PPT format is not fully supported. Please convert your .ppt file to .pptx format and re-upload.');
    const result = await parseOfficeAsync(filePath);
    const extractedText = typeof result === 'string' ? result.trim() : (result?.text || '').trim();
    if (!extractedText) throw new Error('PPT contains no extractable text. If the file is in legacy .ppt format, please convert to .pptx and re-upload.');
    return extractedText;
  }

  throw new Error(`Unsupported file type: ${mimeType}`);
}

async function updateDashboardDocument(documentId: string, data: Record<string, unknown>): Promise<void> {
  await fetch(`${config.dashboardServiceUrl}/api/internal/documents/${documentId}`, {
    method: 'PUT',
    headers: {
      'content-type': 'application/json',
      'x-internal-api-key': config.internalApiKey,
    },
    body: JSON.stringify(data),
    signal: AbortSignal.timeout(15000),
  }).catch((error: any) => logger.warn('Failed to update dashboard document status', { documentId, error: error.message }));
}

async function storeExtractedText(input: Omit<ProcessDocumentInput, 'fileBuffer' | 'mimeType' | 'fileHash' | 'tracePrefix'> & { content: string }) {
  const docTitle = input.title || input.originalName;
  let smartChunks;
  let usedAiChunking = false;

  try {
    smartChunks = await smartChunkDocument(input.content, docTitle, input.villageId || undefined);
    usedAiChunking = true;
  } catch (error: any) {
    logger.warn('AI smart chunking failed, falling back to semantic chunking', { documentId: input.documentId, error: error.message });
    const fallbackChunks = await processDocumentSemanticChunking(input.content, input.documentId, 1500);
    smartChunks = fallbackChunks.map((c, idx) => ({
      title: c.sectionTitle || c.metadata?.sectionTitle || docTitle,
      category: input.category || 'umum',
      content: c.content,
      _embedding: c.embedding,
      _embeddingModel: c.embeddingModel,
      _embeddingDimensions: c.embeddingDimensions,
      paragraphRange: [idx + 1, idx + 1] as [number, number],
    }));
  }

  if (smartChunks.length === 0) throw new Error('No chunks generated from document');

  const chunksWithEmbeddings = usedAiChunking
    ? (() => null)()
    : smartChunks.map((c: any) => ({
        title: c.title,
        category: c.category,
        content: c.content,
        embedding: c._embedding,
        embeddingModel: c._embeddingModel,
        embeddingDimensions: c._embeddingDimensions,
      }));

  let finalChunks = chunksWithEmbeddings;
  if (!finalChunks) {
    const texts = smartChunks.map(c => `${c.title}\n${c.content}`);
    const batchResult = await generateBatchEmbeddings(texts, {
      taskType: 'RETRIEVAL_DOCUMENT',
      outputDimensionality: 768,
    });
    finalChunks = smartChunks.map((chunk, idx) => ({
      title: chunk.title,
      category: chunk.category,
      content: chunk.content,
      embedding: batchResult.embeddings[idx].values,
      embeddingModel: batchResult.embeddings[idx].model,
      embeddingDimensions: batchResult.embeddings[idx].dimensions,
    }));
  }

  await deleteDocumentVectors(input.documentId);
  await addDocumentChunks(finalChunks.map((chunk, idx) => ({
    documentId: input.documentId,
    villageId: input.isGlobal ? null : input.villageId || null,
    scope: input.isGlobal ? 'global' : 'village',
    isGlobal: Boolean(input.isGlobal),
    chunkIndex: idx,
    content: chunk.content,
    embedding: chunk.embedding,
    documentTitle: docTitle,
    category: chunk.category,
    sectionTitle: chunk.title,
  })));

  return { chunksCount: finalChunks.length, usedAiChunking };
}

function billingGroupId(input: ProcessDocumentInput): string {
  const hash = input.fileHash || crypto.createHash('sha256').update(input.fileBuffer).digest('hex');
  return `ingest:document:${input.documentId}:${hash}`;
}

export async function processDocumentBufferWithBilling(input: ProcessDocumentInput) {
  const traceId = `${input.tracePrefix || 'document'}-${input.documentId}-${Date.now()}`;
  return withAiBillingTurn({
    village_id: input.villageId || null,
    message_id: `ingest:${input.documentId}`,
    trace_id: traceId,
    billing_group_id: billingGroupId(input),
    channel: 'system_ingest',
    session_id: `ingest:${input.documentId}`,
  }, async () => {
    const tempFile = await createTempUploadFile({ buffer: input.fileBuffer, originalName: input.originalName });
    try {
      const content = await parseFileContent(tempFile.filePath, input.mimeType);
      if (!content.trim()) throw new Error('Document is empty or could not extract text');
      return await storeExtractedText({
        documentId: input.documentId,
        originalName: input.originalName,
        title: input.title,
        category: input.category,
        villageId: input.villageId,
        isGlobal: Boolean(input.isGlobal),
        content,
      });
    } catch (error: any) {
      if (input.mimeType === 'application/pdf' && isScannedPdfError(error)) {
        await enqueueDocumentOcrJob(input, error.message);
        await updateDashboardDocument(input.documentId, { status: 'ocr_pending', error_message: 'Dokumen terdeteksi scan/image-based. OCR sedang dijadwalkan.' });
        return { chunksCount: 0, usedAiChunking: false, queuedOcr: true };
      }
      throw error;
    } finally {
      await tempFile.cleanup();
    }
  });
}

export async function enqueueDocumentOcrJob(input: ProcessDocumentInput, reason: string): Promise<void> {
  const fileHash = input.fileHash || crypto.createHash('sha256').update(input.fileBuffer).digest('hex');
  const payload = {
    documentId: input.documentId,
    originalName: input.originalName,
    mimeType: input.mimeType,
    title: input.title || null,
    category: input.category || null,
    villageId: input.isGlobal ? null : input.villageId || null,
    isGlobal: Boolean(input.isGlobal),
    fileHash,
    fileBase64: input.fileBuffer.toString('base64'),
  };

  await prisma.$executeRaw`
    INSERT INTO ai.embedding_jobs (
      id, type, target_id, status, stage, error_message, last_error_code,
      next_retry_at, payload_json, created_at
    ) VALUES (
      ${`document_ocr_${input.documentId}`}, 'document_ocr', ${input.documentId}, 'pending', 'ocr',
      ${reason}, 'ocr_pending', NOW(), ${payload}::jsonb, NOW()
    )
    ON CONFLICT (id) DO UPDATE SET
      status = 'pending',
      stage = 'ocr',
      error_message = EXCLUDED.error_message,
      last_error_code = 'ocr_pending',
      retry_count = 0,
      started_at = NULL,
      completed_at = NULL,
      next_retry_at = NOW(),
      payload_json = EXCLUDED.payload_json
  `;
}

async function runOcrProvider(fileBuffer: Buffer, mimeType: string): Promise<string> {
  const endpoint = process.env.OCR_PROVIDER_URL?.trim();
  if (!endpoint) throw new Error('OCR_PROVIDER_URL is not configured');

  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(process.env.OCR_PROVIDER_API_KEY ? { authorization: `Bearer ${process.env.OCR_PROVIDER_API_KEY}` } : {}),
    },
    body: JSON.stringify({ mimeType, fileBase64: fileBuffer.toString('base64') }),
    signal: AbortSignal.timeout(Number(process.env.OCR_PROVIDER_TIMEOUT_MS || 120000)),
  });

  const payload = await response.json().catch(() => null) as any;
  if (!response.ok) throw new Error(payload?.error || `OCR provider failed with ${response.status}`);
  const text = payload?.text || payload?.data?.text || payload?.result?.text || '';
  if (!String(text).trim()) throw new Error('OCR provider returned empty text');
  return String(text);
}

async function processOneOcrJob() {
  const maxRetries = Number(process.env.OCR_MAX_RETRIES || 3);
  const rows = await prisma.$queryRaw<Array<{
    id: string;
    target_id: string;
    retry_count: number;
    payload_json: any;
  }>>`
    SELECT id, target_id, retry_count, payload_json
    FROM ai.embedding_jobs
    WHERE type = 'document_ocr'
      AND status IN ('pending', 'failed')
      AND (next_retry_at IS NULL OR next_retry_at <= NOW())
      AND retry_count < ${maxRetries}
    ORDER BY priority DESC, created_at ASC
    LIMIT 1
  `;
  const job = rows[0];
  if (!job?.payload_json) return;

  const payload = job.payload_json as any;
  const documentId = payload.documentId || job.target_id;
  await prisma.$executeRaw`
    UPDATE ai.embedding_jobs
    SET status = 'processing', started_at = NOW(), last_error_code = NULL
    WHERE id = ${job.id}
  `;
  await updateDashboardDocument(documentId, { status: 'ocr_pending', error_message: 'OCR sedang diproses.' });

  try {
    const fileBuffer = Buffer.from(payload.fileBase64, 'base64');
    const ocrText = await runOcrProvider(fileBuffer, payload.mimeType || 'application/pdf');
    const fileHash = payload.fileHash || crypto.createHash('sha256').update(fileBuffer).digest('hex');

    await withAiBillingTurn({
      village_id: payload.villageId || null,
      message_id: `ingest:${documentId}`,
      trace_id: `document-ocr-${documentId}-${Date.now()}`,
      billing_group_id: `ingest:document:${documentId}:${fileHash}`,
      channel: 'system_ingest',
      session_id: `ingest:${documentId}`,
    }, async () => {
      const result = await storeExtractedText({
        documentId,
        originalName: payload.originalName || `document-${documentId}`,
        title: payload.title || undefined,
        category: payload.category || undefined,
        villageId: payload.isGlobal ? null : payload.villageId || null,
        isGlobal: Boolean(payload.isGlobal),
        content: ocrText,
      });
      await updateDashboardDocument(documentId, { status: 'completed', error_message: null, total_chunks: result.chunksCount });
    });

    await prisma.$executeRaw`
      UPDATE ai.embedding_jobs
      SET status = 'completed', completed_at = NOW(), error_message = NULL, last_error_code = NULL, next_retry_at = NULL
      WHERE id = ${job.id}
    `;
  } catch (error: any) {
    const retryCount = job.retry_count + 1;
    const failedFinal = retryCount >= maxRetries;
    const nextRetryAt = failedFinal ? null : new Date(Date.now() + Math.min(30 * 60_000, 2 ** retryCount * 60_000));
    await prisma.$executeRaw`
      UPDATE ai.embedding_jobs
      SET status = ${failedFinal ? 'failed' : 'pending'},
          retry_count = ${retryCount},
          error_message = ${error.message},
          last_error_code = ${failedFinal ? 'ocr_fail' : 'ocr_retry'},
          next_retry_at = ${nextRetryAt}
      WHERE id = ${job.id}
    `;
    await updateDashboardDocument(documentId, {
      status: failedFinal ? 'ocr_fail' : 'retrying',
      error_message: error.message,
    });
  }
}

let ocrWorkerStarted = false;
export function startDocumentOcrWorker(): void {
  if (ocrWorkerStarted) return;
  ocrWorkerStarted = true;
  registerInterval(() => {
    processOneOcrJob().catch((error: any) => logger.error('OCR worker tick failed', { error: error.message }));
  }, Number(process.env.OCR_WORKER_INTERVAL_MS || 30000), 'document-ocr-worker');
}
