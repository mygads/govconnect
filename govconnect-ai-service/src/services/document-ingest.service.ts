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
import { callAIGatewayPrompt, NoCapableGatewayModelError } from './ai-gateway.service';
import { runDocVsDocForDocument } from './knowledge-consistency.service';
import { runDocVsDbForDocument } from './doc-vs-db-pipeline.service';

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

type SourceKind = 'text' | 'page' | 'sheet' | 'table' | 'image' | 'ocr';

interface ExtractionUnit {
  content: string;
  sourceKind: SourceKind;
  pageNumber?: number;
  sheetName?: string;
  tableIndex?: number;
  rowRange?: [number, number];
  sectionTitle?: string;
}

interface ExtractedDocument {
  units: ExtractionUnit[];
  extractionMode: 'text' | 'office' | 'spreadsheet' | 'pdf_text' | 'ocr_provider' | 'vision_llm';
}

class OcrRequiredError extends Error {
  constructor(message = 'Document contains no extractable text. OCR is required.') {
    super(message);
    this.name = 'OcrRequiredError';
  }
}

function isOcrRequiredError(error: any): boolean {
  const message = String(error?.message || '').toLowerCase();
  return error instanceof OcrRequiredError || message.includes('no extractable text') || message.includes('scanned') || message.includes('image-based') || message.includes('ocr is required');
}

function getExtension(filename?: string): string {
  return path.extname(filename || '').replace(/^\./, '').toLowerCase();
}

function normalizedMimeType(mimeType: string, originalName?: string): string {
  const mime = (mimeType || '').toLowerCase().split(';')[0].trim();
  if (mime && mime !== 'application/octet-stream') return mime;
  switch (getExtension(originalName)) {
    case 'pdf': return 'application/pdf';
    case 'docx': return 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
    case 'doc': return 'application/msword';
    case 'pptx': return 'application/vnd.openxmlformats-officedocument.presentationml.presentation';
    case 'ppt': return 'application/vnd.ms-powerpoint';
    case 'xlsx': return 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
    case 'xls': return 'application/vnd.ms-excel';
    case 'md': return 'text/markdown';
    case 'csv': return 'text/csv';
    case 'txt': return 'text/plain';
    case 'png': return 'image/png';
    case 'jpg':
    case 'jpeg': return 'image/jpeg';
    case 'webp': return 'image/webp';
    case 'tif':
    case 'tiff': return 'image/tiff';
    case 'bmp': return 'image/bmp';
    default: return mime || 'application/octet-stream';
  }
}

function isImageMime(mimeType: string): boolean {
  return mimeType.startsWith('image/');
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

function formatDelimitedRows(text: string): string[] {
  const lines = text.split(/\r?\n/).map(line => line.trim()).filter(Boolean);
  if (lines.length < 2) return [text];
  const delimiter = lines[0].includes('\t') ? '\t' : ',';
  const rows = lines.map(line => line.split(delimiter).map(cell => cell.trim().replace(/^"|"$/g, '')));
  const columnCount = Math.max(...rows.map(row => row.length));
  if (columnCount < 2) return [text];
  return rows.map((row, idx) => `${idx === 0 ? 'Header' : `Row ${idx}`}: ${row.join(' | ')}`);
}

function extractPdfPageText(page: any, pageNumber: number): string {
  const items = (page.content || [])
    .filter((item: any) => item.str && item.str.trim())
    .map((item: any) => ({ text: String(item.str).trim(), x: Number(item.x || 0), y: Number(item.y || 0) }))
    .sort((a: any, b: any) => Math.abs(a.y - b.y) > 2 ? b.y - a.y : a.x - b.x);

  const rows: Array<{ y: number; cells: Array<{ text: string; x: number }> }> = [];
  for (const item of items) {
    const row = rows.find(candidate => Math.abs(candidate.y - item.y) <= 2);
    if (row) row.cells.push({ text: item.text, x: item.x });
    else rows.push({ y: item.y, cells: [{ text: item.text, x: item.x }] });
  }

  return rows.map((row, idx) => {
    const cells = row.cells.sort((a, b) => a.x - b.x).map(cell => cell.text);
    const separator = cells.length > 2 ? ' | ' : ' ';
    return `${cells.length > 2 ? `Tabel/Baris ${pageNumber}.${idx + 1}: ` : ''}${cells.join(separator)}`;
  }).join('\n');
}

function unitsToText(units: ExtractionUnit[]): string {
  return units.map(unit => {
    const labels = [
      unit.sourceKind === 'page' && unit.pageNumber ? `Halaman ${unit.pageNumber}` : null,
      unit.sheetName ? `Sheet ${unit.sheetName}` : null,
      unit.rowRange ? `Row ${unit.rowRange[0]}-${unit.rowRange[1]}` : null,
      unit.sectionTitle || null,
    ].filter(Boolean).join(' > ');
    return `${labels ? `[${labels}]\n` : ''}${unit.content}`;
  }).join('\n\n');
}

function findUnitForContent(units: ExtractionUnit[], content: string): ExtractionUnit | undefined {
  const normalized = content.replace(/^\[\.\.\.\]\s*/, '').slice(0, 160).toLowerCase();
  return units.find(unit => unit.content.toLowerCase().includes(normalized) || normalized.includes(unit.content.slice(0, 80).toLowerCase()));
}

async function parseSpreadsheet(filePath: string): Promise<ExtractedDocument> {
  const xlsx = await import('xlsx');
  const workbook = xlsx.readFile(filePath, { cellDates: true });
  const units: ExtractionUnit[] = [];
  const maxRowsPerSheet = Number(process.env.DOCUMENT_SPREADSHEET_MAX_ROWS_PER_SHEET || 1000);

  for (const sheetName of workbook.SheetNames) {
    const worksheet = workbook.Sheets[sheetName];
    const rows = xlsx.utils.sheet_to_json<any[]>(worksheet, { header: 1, raw: false, defval: '' })
      .map(row => row.map(cell => String(cell || '').trim()))
      .filter(row => row.some(cell => cell.length > 0));
    if (rows.length === 0) continue;

    const limitedRows = rows.slice(0, maxRowsPerSheet);
    const header = limitedRows[0] || [];
    const body = limitedRows.slice(1);
    const lines = [`Sheet: ${sheetName}`, `Header: ${header.join(' | ')}`];
    body.forEach((row, idx) => lines.push(`Row ${idx + 1}: ${row.join(' | ')}`));
    if (rows.length > limitedRows.length) lines.push(`[TRUNCATED: ${rows.length - limitedRows.length} rows omitted]`);

    units.push({
      content: lines.join('\n'),
      sourceKind: 'sheet',
      sheetName,
      rowRange: [1, limitedRows.length],
      sectionTitle: `Sheet ${sheetName}`,
    });
  }

  if (units.length === 0) throw new Error('Spreadsheet contains no extractable text.');
  return { units, extractionMode: 'spreadsheet' };
}

async function parseFileContent(filePath: string, mimeType: string, originalName: string): Promise<ExtractedDocument> {
  const normalizedMime = normalizedMimeType(mimeType, originalName);

  if (isImageMime(normalizedMime)) {
    throw new OcrRequiredError('Image document requires OCR or vision extraction.');
  }

  if (normalizedMime === 'text/plain' || normalizedMime === 'text/markdown' || normalizedMime === 'text/x-markdown') {
    return { units: [{ content: await fs.readFile(filePath, 'utf-8'), sourceKind: 'text', sectionTitle: originalName }], extractionMode: 'text' };
  }

  if (normalizedMime === 'text/csv') {
    const rows = formatDelimitedRows(await fs.readFile(filePath, 'utf-8'));
    return { units: [{ content: rows.join('\n'), sourceKind: 'table', tableIndex: 1, rowRange: [1, rows.length], sectionTitle: 'CSV Table' }], extractionMode: 'spreadsheet' };
  }

  if (normalizedMime === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' || normalizedMime === 'application/vnd.ms-excel') {
    return parseSpreadsheet(filePath);
  }

  if (normalizedMime === 'application/pdf') {
    try {
      const { PDFExtract } = await import('pdf.js-extract');
      const pdfExtract = new PDFExtract();
      const data = await pdfExtract.extract(filePath, {});
      const units = data.pages.map((page: any, idx: number) => {
        const pageNumber = idx + 1;
        return {
          content: extractPdfPageText(page, pageNumber).trim(),
          sourceKind: 'page' as const,
          pageNumber,
          sectionTitle: `Halaman ${pageNumber}`,
        };
      }).filter((unit: ExtractionUnit) => unit.content.trim());
      if (units.length === 0) throw new OcrRequiredError('PDF contains no extractable text. It may be scanned/image-based.');
      return { units, extractionMode: 'pdf_text' };
    } catch (pdfError: any) {
      if (pdfError instanceof OcrRequiredError) throw pdfError;
      if (pdfError.message?.includes('Invalid PDF structure') || pdfError.message?.includes('Invalid')) {
        throw new Error('PDF file appears to be corrupted or uses an unsupported format.');
      }
      if (pdfError.message?.includes('password')) {
        throw new Error('PDF is password protected. Please remove the password and try again.');
      }
      throw new Error(`Failed to parse PDF: ${pdfError.message}`);
    }
  }

  if (normalizedMime.includes('wordprocessingml')) {
    const mammoth = await import('mammoth');
    const result = await mammoth.extractRawText({ path: filePath });
    if (!result.value?.trim()) throw new Error('DOCX contains no extractable text.');
    return { units: [{ content: result.value, sourceKind: 'text', sectionTitle: originalName }], extractionMode: 'office' };
  }

  if (normalizedMime === 'application/msword') {
    const WordExtractor = (await import('word-extractor')).default;
    const extractor = new WordExtractor();
    const doc = await extractor.extract(filePath);
    const extractedText = doc.getBody()?.trim() || '';
    if (!extractedText) throw new Error('DOC contains no extractable text.');
    return { units: [{ content: extractedText, sourceKind: 'text', sectionTitle: originalName }], extractionMode: 'office' };
  }

  if (normalizedMime === 'application/vnd.openxmlformats-officedocument.presentationml.presentation') {
    const officeParser: any = await import('officeparser');
    const parseOfficeAsync = officeParser.parseOfficeAsync || officeParser.default?.parseOfficeAsync || officeParser.parseOffice;
    if (!parseOfficeAsync) throw new Error('Office parser not available');
    const result = await parseOfficeAsync(filePath);
    const text = typeof result === 'string' ? result : result?.text || '';
    if (!text.trim()) throw new Error('PPTX contains no extractable text.');
    return { units: [{ content: text, sourceKind: 'text', sectionTitle: originalName }], extractionMode: 'office' };
  }

  if (normalizedMime === 'application/vnd.ms-powerpoint') {
    const officeParser: any = await import('officeparser');
    const parseOfficeAsync = officeParser.parseOfficeAsync || officeParser.default?.parseOfficeAsync;
    if (!parseOfficeAsync) throw new Error('Legacy PPT format is not fully supported. Please convert your .ppt file to .pptx format and re-upload.');
    const result = await parseOfficeAsync(filePath);
    const extractedText = typeof result === 'string' ? result.trim() : (result?.text || '').trim();
    if (!extractedText) throw new Error('PPT contains no extractable text. If the file is in legacy .ppt format, please convert to .pptx and re-upload.');
    return { units: [{ content: extractedText, sourceKind: 'text', sectionTitle: originalName }], extractionMode: 'office' };
  }

  throw new Error(`Unsupported file type: ${normalizedMime}`);
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

async function storeExtractedText(input: Omit<ProcessDocumentInput, 'fileBuffer' | 'mimeType' | 'fileHash' | 'tracePrefix'> & { extracted: ExtractedDocument }) {
  const docTitle = input.title || input.originalName;
  const content = unitsToText(input.extracted.units);
  let smartChunks;
  let usedAiChunking = false;

  try {
    smartChunks = await smartChunkDocument(content, docTitle, input.villageId || undefined);
    usedAiChunking = true;
  } catch (error: any) {
    logger.warn('AI smart chunking failed, falling back to semantic chunking', { documentId: input.documentId, error: error.message });
    const fallbackChunks = await processDocumentSemanticChunking(content, input.documentId, 1500, {
      village_id: input.villageId || null,
    });
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
      context: {
        village_id: input.villageId || null,
      },
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
  await addDocumentChunks(finalChunks.map((chunk, idx) => {
    const unit = findUnitForContent(input.extracted.units, chunk.content) || input.extracted.units[0];
    const provenance = {
      extractionMode: input.extracted.extractionMode,
      sourceKind: unit?.sourceKind || 'text',
      pageNumber: unit?.pageNumber,
      sheetName: unit?.sheetName,
      tableIndex: unit?.tableIndex,
      rowRange: unit?.rowRange,
      sectionTitle: unit?.sectionTitle || chunk.title,
      paragraphRange: (chunk as any).paragraphRange,
    };
    return {
      documentId: input.documentId,
      villageId: input.isGlobal ? null : input.villageId || null,
      scope: input.isGlobal ? 'global' : 'village',
      isGlobal: Boolean(input.isGlobal),
      chunkIndex: idx,
      content: chunk.content,
      embedding: chunk.embedding,
      documentTitle: docTitle,
      category: chunk.category,
      pageNumber: unit?.pageNumber,
      sectionTitle: chunk.title,
      provenance,
    };
  }));

  return { chunksCount: finalChunks.length, usedAiChunking };
}

/**
 * Fire-and-forget post-ingest consistency audit.
 *
 * Runs doc-vs-doc against the village corpus and doc-vs-db against
 * structured ground truth. Errors are swallowed — this is observability,
 * not a critical ingest path.
 *
 * Concurrency is bounded by CONSISTENCY_AUDIT_CONCURRENCY (default 2) so
 * bulk ingests don't pile up on DB. Lost audits (on shutdown) are
 * recoverable via `POST /api/knowledge-consistency/scan`.
 */
const MAX_AUDIT_CONCURRENCY = Math.max(
  1,
  Number(process.env.CONSISTENCY_AUDIT_CONCURRENCY || 2),
);
const MAX_AUDIT_QUEUE = Math.max(
  MAX_AUDIT_CONCURRENCY,
  Number(process.env.CONSISTENCY_AUDIT_MAX_QUEUE || 200),
);
let auditInFlight = 0;
const auditQueue: Array<{ documentId: string; villageId: string | null }> = [];
const auditSeen = new Set<string>();

function drainAuditQueue(): void {
  while (auditInFlight < MAX_AUDIT_CONCURRENCY && auditQueue.length > 0) {
    const job = auditQueue.shift()!;
    auditSeen.delete(`${job.documentId}::${job.villageId ?? ''}`);
    auditInFlight++;
    runAuditJob(job).finally(() => {
      auditInFlight--;
      drainAuditQueue();
    });
  }
}

async function runAuditJob(job: { documentId: string; villageId: string | null }): Promise<void> {
  try {
    await runDocVsDocForDocument({ documentId: job.documentId, villageId: job.villageId });
  } catch (error: any) {
    logger.warn('post-ingest doc-vs-doc audit failed', {
      documentId: job.documentId,
      villageId: job.villageId,
      error: error.message,
    });
  }

  if (job.villageId) {
    try {
      await runDocVsDbForDocument({ documentId: job.documentId, villageId: job.villageId });
    } catch (error: any) {
      logger.warn('post-ingest doc-vs-db audit failed', {
        documentId: job.documentId,
        villageId: job.villageId,
        error: error.message,
      });
    }
  }
}

export function scheduleConsistencyAuditForDocument(params: {
  documentId: string;
  villageId?: string | null;
}): void {
  const { documentId, villageId } = params;
  if (!documentId) return;

  const seenKey = `${documentId}::${villageId ?? ''}`;
  if (auditSeen.has(seenKey)) return;

  if (auditQueue.length >= MAX_AUDIT_QUEUE) {
    logger.warn('consistency audit queue full, dropping oldest', {
      queued: auditQueue.length,
      limit: MAX_AUDIT_QUEUE,
    });
    const dropped = auditQueue.shift();
    if (dropped) auditSeen.delete(`${dropped.documentId}::${dropped.villageId ?? ''}`);
  }

  auditSeen.add(seenKey);
  auditQueue.push({ documentId, villageId: villageId ?? null });
  setImmediate(drainAuditQueue);
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
      const extracted = await parseFileContent(tempFile.filePath, input.mimeType, input.originalName);
      if (!unitsToText(extracted.units).trim()) throw new Error('Document is empty or could not extract text');
      const result = await storeExtractedText({
        documentId: input.documentId,
        originalName: input.originalName,
        title: input.title,
        category: input.category,
        villageId: input.villageId,
        isGlobal: Boolean(input.isGlobal),
        extracted,
      });

      // Fire-and-forget consistency audit. Only runs for village-scoped
      // docs (global docs have no single DB ground truth to compare to).
      if (!input.isGlobal && result.chunksCount > 0) {
        scheduleConsistencyAuditForDocument({
          documentId: input.documentId,
          villageId: input.villageId || null,
        });
      }

      return result;
    } catch (error: any) {
      if (isOcrRequiredError(error)) {
        await enqueueDocumentOcrJob(input, error.message);
        await updateDashboardDocument(input.documentId, { status: 'ocr_pending', error_message: 'Dokumen membutuhkan OCR/vision. Pemrosesan sedang dijadwalkan.' });
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
    mimeType: normalizedMimeType(input.mimeType, input.originalName),
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

async function runOcrProvider(fileBuffer: Buffer, mimeType: string): Promise<{ text: string; mode: 'ocr_provider'; provider: string }> {
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
  return { text: String(text), mode: 'ocr_provider', provider: endpoint };
}

async function runVisionFallback(fileBuffer: Buffer, mimeType: string, originalName: string, villageId?: string | null): Promise<{ text: string; mode: 'vision_llm'; provider?: string; model?: string }> {
  const result = await callAIGatewayPrompt({
    lane: 'llm',
    modelPriority: [],
    requiredCapability: 'vision',
    temperature: 0.1,
    maxTokens: Number(process.env.DOCUMENT_VISION_MAX_TOKENS || 4096),
    layerType: 'full_nlu',
    callType: 'media_analysis',
    context: { village_id: villageId || null, channel: 'system_ingest' },
    messages: [
      {
        role: 'system',
        content: 'Ekstrak seluruh teks yang terlihat dari dokumen/gambar untuk RAG GovConnect. Pertahankan tabel sebagai baris Header/Row, jangan mengarang teks yang tidak terlihat, dan jawab hanya teks hasil ekstraksi dalam Bahasa Indonesia jika ada.',
      },
      {
        role: 'user',
        content: [
          { type: 'text', text: `Nama file: ${originalName}. Ekstrak teks, tabel, nomor, dan label yang terlihat.` },
          { type: 'image_url', image_url: { url: `data:${mimeType};base64,${fileBuffer.toString('base64')}` } },
        ],
      },
    ],
  });

  const text = result?.text?.trim() || '';
  if (!text) throw new Error('Vision model returned empty text');
  return { text, mode: 'vision_llm', provider: result?.provider, model: result?.model };
}

async function extractWithOcrOrVision(input: { fileBuffer: Buffer; mimeType: string; originalName: string; villageId?: string | null }): Promise<ExtractedDocument & { provider?: string; model?: string }> {
  try {
    const ocr = await runOcrProvider(input.fileBuffer, input.mimeType);
    return {
      units: [{ content: ocr.text, sourceKind: 'ocr', sectionTitle: input.originalName }],
      extractionMode: ocr.mode,
      provider: ocr.provider,
    };
  } catch (ocrError: any) {
    logger.warn('OCR provider failed, trying vision fallback', { originalName: input.originalName, error: ocrError.message });
    try {
      const vision = await runVisionFallback(input.fileBuffer, input.mimeType, input.originalName, input.villageId);
      return {
        units: [{ content: vision.text, sourceKind: 'image', sectionTitle: input.originalName }],
        extractionMode: vision.mode,
        provider: vision.provider,
        model: vision.model,
      };
    } catch (visionError: any) {
      if (visionError instanceof NoCapableGatewayModelError) throw ocrError;
      throw new Error(`OCR/vision extraction failed: ${ocrError.message}; vision fallback: ${visionError.message}`);
    }
  }
}

async function processOneOcrJob() {
  const maxRetries = Number(process.env.OCR_MAX_RETRIES || 3);
  const job = await prisma.$transaction(async (tx) => {
    const rows = await tx.$queryRaw<Array<{
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
      FOR UPDATE SKIP LOCKED
      LIMIT 1
    `;

    const claimed = rows[0];
    if (!claimed?.payload_json) {
      return null;
    }

    await tx.$executeRaw`
      UPDATE ai.embedding_jobs
      SET status = 'processing', started_at = NOW(), last_error_code = NULL
      WHERE id = ${claimed.id}
    `;

    return claimed;
  });

  if (!job?.payload_json) return;

  const payload = job.payload_json as any;
  const documentId = payload.documentId || job.target_id;
  await updateDashboardDocument(documentId, { status: 'ocr_pending', error_message: 'OCR/vision sedang diproses.' });

  try {
    const fileBuffer = Buffer.from(payload.fileBase64, 'base64');
    const fileHash = payload.fileHash || crypto.createHash('sha256').update(fileBuffer).digest('hex');
    const extracted = await extractWithOcrOrVision({
      fileBuffer,
      mimeType: payload.mimeType || 'application/pdf',
      originalName: payload.originalName || `document-${documentId}`,
      villageId: payload.villageId || null,
    });

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
        extracted,
      });
      await updateDashboardDocument(documentId, { status: 'completed', error_message: null, total_chunks: result.chunksCount });
      if (!payload.isGlobal && result.chunksCount > 0) {
        scheduleConsistencyAuditForDocument({
          documentId,
          villageId: payload.villageId || null,
        });
      }
    });

    await prisma.$executeRaw`
      UPDATE ai.embedding_jobs
      SET status = 'completed', completed_at = NOW(), error_message = NULL, last_error_code = NULL, next_retry_at = NULL,
          payload_json = payload_json || ${JSON.stringify({ extractionMode: extracted.extractionMode, provider: extracted.provider, model: extracted.model })}::jsonb
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
