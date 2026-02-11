/**
 * Document Upload Route for AI Service
 * 
 * Handles file upload, parsing, chunking, and embedding:
 * 1. Receive file from Dashboard
 * 2. Save file locally
 * 3. Parse content (PDF, DOCX, TXT)
 * 4. Chunk the text
 * 5. Generate embeddings
 * 6. Store vectors
 */

import { Router, Request, Response } from 'express';
import multer from 'multer';
import path from 'path';
import fs from 'fs/promises';
import { existsSync, mkdirSync } from 'fs';
import logger from '../utils/logger';
import { processDocumentSemanticChunking } from '../services/document-processor.service';
import { smartChunkDocument } from '../services/ai-chunking.service';
import { generateBatchEmbeddings } from '../services/embedding.service';
import { addDocumentChunks } from '../services/vector-db.service';
import { config } from '../config/env';
import { firstHeader, getParam } from '../utils/http';

const router = Router();

// Configure multer for file uploads
const uploadDir = path.join(process.cwd(), 'uploads', 'documents');

// Ensure upload directory exists (graceful — don't crash if permission denied)
try {
  if (!existsSync(uploadDir)) {
    mkdirSync(uploadDir, { recursive: true });
  }
} catch (err: any) {
  console.error(`Warning: Could not create upload directory ${uploadDir}: ${err.message}`);
  console.error('File uploads will fail until the directory is created with proper permissions.');
}

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => {
    cb(null, uploadDir);
  },
  filename: (_req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    const ext = path.extname(file.originalname);
    cb(null, `doc-${uniqueSuffix}${ext}`);
  }
});

const upload = multer({
  storage,
  limits: {
    fileSize: 10 * 1024 * 1024, // 10MB
  },
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
  }
});

// Internal API key verification middleware
function verifyInternalKey(req: Request, res: Response, next: Function) {
  const apiKey = firstHeader(req.headers['x-internal-api-key']);
  
  if (!apiKey || apiKey !== config.internalApiKey) {
    return res.status(403).json({ error: 'Unauthorized' });
  }
  
  next();
}

/**
 * Parse file content based on mime type
 */
async function parseFileContent(filePath: string, mimeType: string): Promise<string> {
  if (mimeType === 'text/plain' || mimeType === 'text/markdown' || mimeType === 'text/csv') {
    return await fs.readFile(filePath, 'utf-8');
  }
  
  if (mimeType === 'application/pdf') {
    try {
      // Using pdf.js-extract (Mozilla PDF.js wrapper) for better compatibility
      const { PDFExtract } = await import('pdf.js-extract');
      const pdfExtract = new PDFExtract();
      
      const data = await pdfExtract.extract(filePath, {});
      
      // Extract text from all pages
      let fullText = '';
      for (const page of data.pages) {
        const pageText = page.content
          .filter((item: any) => item.str && item.str.trim())
          .map((item: any) => item.str)
          .join(' ');
        fullText += pageText + '\n\n';
      }
      
      fullText = fullText.trim();
      
      if (!fullText || fullText.length === 0) {
        throw new Error('PDF contains no extractable text. It may be scanned/image-based.');
      }
      
      logger.info('PDF parsed successfully', {
        pages: data.pages.length,
        textLength: fullText.length,
      });
      
      return fullText;
    } catch (pdfError: any) {
      logger.error('PDF parsing error', { error: pdfError.message, stack: pdfError.stack });
      
      if (pdfError.message.includes('Invalid PDF structure') || pdfError.message.includes('Invalid')) {
        throw new Error('PDF file appears to be corrupted or uses an unsupported format.');
      }
      if (pdfError.message.includes('password')) {
        throw new Error('PDF is password protected. Please remove the password and try again.');
      }
      throw new Error(`Failed to parse PDF: ${pdfError.message}`);
    }
  }
  
  if (mimeType.includes('wordprocessingml')) {
    try {
      const mammoth = await import('mammoth');
      const result = await mammoth.extractRawText({ path: filePath });

      if (!result.value || result.value.trim().length === 0) {
        throw new Error('DOCX contains no extractable text.');
      }

      return result.value;
    } catch (docxError: any) {
      logger.error('DOCX parsing error', { error: docxError.message });
      throw new Error(`Failed to parse DOCX: ${docxError.message}`);
    }
  }

  if (mimeType === 'application/msword') {
    try {
      const WordExtractor = (await import('word-extractor')).default;
      const extractor = new WordExtractor();
      const doc = await extractor.extract(filePath);
      const extractedText = doc.getBody()?.trim() || '';

      if (!extractedText || extractedText.length === 0) {
        throw new Error('DOC contains no extractable text.');
      }

      return extractedText;
    } catch (docError: any) {
      logger.error('DOC parsing error', { error: docError.message });
      throw new Error(`Failed to parse DOC: ${docError.message}`);
    }
  }

  if (mimeType === 'application/vnd.openxmlformats-officedocument.presentationml.presentation') {
    try {
      const officeParser: any = await import('officeparser');
      const parseOfficeAsync = officeParser.parseOfficeAsync || officeParser.default?.parseOfficeAsync || officeParser.parseOffice;

      if (!parseOfficeAsync) {
        throw new Error('Office parser not available');
      }

      const result = await parseOfficeAsync(filePath);
      const text = typeof result === 'string' ? result : result?.text || '';

      if (!text || text.trim().length === 0) {
        throw new Error('PPTX contains no extractable text.');
      }

      return text;
    } catch (pptxError: any) {
      logger.error('PPTX parsing error', { error: pptxError.message });
      throw new Error(`Failed to parse PPTX: ${pptxError.message}`);
    }
  }

  if (mimeType === 'application/vnd.ms-powerpoint') {
    try {
      const officeParser: any = await import('officeparser');
      const parseOfficeAsync = officeParser.parseOfficeAsync || officeParser.default?.parseOfficeAsync;

      if (!parseOfficeAsync) {
        throw new Error('Legacy PPT format is not fully supported. Please convert your .ppt file to .pptx format and re-upload.');
      }

      const result = await parseOfficeAsync(filePath);
      const extractedText = typeof result === 'string' ? result.trim() : (result?.text || '').trim();

      if (!extractedText || extractedText.length === 0) {
        throw new Error('PPT contains no extractable text. If the file is in legacy .ppt format, please convert to .pptx and re-upload.');
      }

      return extractedText;
    } catch (pptError: any) {
      logger.error('PPT parsing error', { error: pptError.message });
      if (pptError.message.includes('convert')) {
        throw pptError; // Pass through conversion messages as-is
      }
      throw new Error(`Failed to parse PPT: ${pptError.message}. Try converting to .pptx format.`);
    }
  }
  
  throw new Error(`Unsupported file type: ${mimeType}`);
}

/**
 * POST /api/upload/document
 * Upload and process a document
 */
router.post('/document', verifyInternalKey, upload.single('file'), async (req: Request, res: Response) => {
  const file = req.file;
  const { documentId, title, category, village_id, villageId } = req.body;
  const resolvedVillageId: string | null = (typeof village_id === 'string' && village_id.length > 0)
    ? village_id
    : (typeof villageId === 'string' && villageId.length > 0)
      ? villageId
      : null;
  
  if (!file) {
    return res.status(400).json({ error: 'No file provided' });
  }
  
  if (!documentId) {
    return res.status(400).json({ error: 'documentId is required' });
  }
  
  logger.info('Received document upload', {
    documentId,
    filename: file.originalname,
    size: file.size,
    mimeType: file.mimetype,
  });
  
  try {
    // Parse file content
    const content = await parseFileContent(file.path, file.mimetype);
    
    if (!content || content.trim().length === 0) {
      // Clean up file
      await fs.unlink(file.path).catch(() => {});
      return res.status(400).json({ error: 'Document is empty or could not extract text' });
    }
    
    logger.info('Document parsed successfully', {
      documentId,
      contentLength: content.length,
    });
    
    // Process document with AI-DRIVEN SMART CHUNKING
    // The AI reads the entire document and decides:
    //  - How to split it (by topic/context, not by character count)
    //  - What title each chunk should have
    //  - What category each chunk belongs to
    // Falls back to semantic chunking if AI fails
    const docTitle = title || file.originalname;
    
    let smartChunks;
    let usedAiChunking = false;
    
    try {
      smartChunks = await smartChunkDocument(content, docTitle);
      usedAiChunking = true;
      logger.info('AI smart chunking succeeded', {
        documentId,
        chunksCount: smartChunks.length,
      });
    } catch (aiErr: any) {
      logger.warn('AI chunking failed, falling back to semantic chunking', {
        documentId,
        error: aiErr.message,
      });
      // Fallback to semantic chunking (non-AI, rule-based)
      const fallbackChunks = await processDocumentSemanticChunking(content, documentId, 1500);
      smartChunks = fallbackChunks.map((c, idx) => ({
        title: c.sectionTitle || c.metadata?.sectionTitle || docTitle,
        category: category || 'umum',
        content: c.content,
        paragraphRange: [idx + 1, idx + 1] as [number, number],
        _embedding: c.embedding,
        _embeddingModel: c.embeddingModel,
        _embeddingDimensions: c.embeddingDimensions,
      }));
    }
    
    if (smartChunks.length === 0) {
      await fs.unlink(file.path).catch(() => {});
      return res.status(400).json({ error: 'No chunks generated from document' });
    }

    // Generate embeddings for AI chunks (fallback chunks already have embeddings)
    let chunksWithEmbeddings: Array<{
      title: string;
      category: string;
      content: string;
      embedding: number[];
      embeddingModel: string;
      embeddingDimensions: number;
    }>;
    
    if (usedAiChunking) {
      // Prepend AI-assigned title to embedding input for better retrieval
      const texts = smartChunks.map(c => `${c.title}\n${c.content}`);
      
      const batchResult = await generateBatchEmbeddings(texts, {
        taskType: 'RETRIEVAL_DOCUMENT',
        outputDimensionality: 768,
      });
      
      chunksWithEmbeddings = smartChunks.map((chunk, idx) => ({
        title: chunk.title,
        category: chunk.category,
        content: chunk.content,
        embedding: batchResult.embeddings[idx].values,
        embeddingModel: batchResult.embeddings[idx].model,
        embeddingDimensions: batchResult.embeddings[idx].dimensions,
      }));
    } else {
      // Fallback chunks already have embeddings from processDocumentSemanticChunking
      chunksWithEmbeddings = smartChunks.map((c: any) => ({
        title: c.title,
        category: c.category,
        content: c.content,
        embedding: c._embedding,
        embeddingModel: c._embeddingModel,
        embeddingDimensions: c._embeddingDimensions,
      }));
    }
    
    // Store chunks with embeddings to vector DB
    // Each chunk gets its AI-assigned title and category
    await addDocumentChunks(chunksWithEmbeddings.map((chunk, idx) => ({
      documentId,
      villageId: resolvedVillageId,
      chunkIndex: idx,
      content: chunk.content,
      embedding: chunk.embedding,
      documentTitle: docTitle,
      category: chunk.category, // AI-assigned per-chunk category
      sectionTitle: chunk.title, // AI-assigned per-chunk title
    })));
    
    // Build the file URL for viewing
    // This URL will be accessible via the static file serving in app.ts
    const fileUrl = `/uploads/documents/${file.filename}`;
    
    logger.info('Document processing completed', {
      documentId,
      chunksCount: chunksWithEmbeddings.length,
      filename: file.filename,
      fileUrl,
      aiChunking: usedAiChunking,
    });
    
    return res.json({
      success: true,
      documentId,
      filename: file.filename,
      fileUrl, // Full path for viewing the document
      originalName: file.originalname,
      fileSize: file.size,
      mimeType: file.mimetype,
      chunksCount: chunksWithEmbeddings.length,
      aiChunking: usedAiChunking,
      message: 'Document uploaded and processed successfully',
    });
  } catch (error: any) {
    logger.error('Document upload/processing failed', {
      documentId,
      error: error.message,
    });
    
    // Clean up file on error
    if (file?.path) {
      await fs.unlink(file.path).catch(() => {});
    }
    
    return res.status(500).json({
      error: 'Document processing failed',
      details: error.message,
    });
  }
});

/**
 * DELETE /api/upload/document/:documentId
 * Delete document and its vectors
 */
router.delete('/document/:documentId', verifyInternalKey, async (req: Request, res: Response) => {
  const documentId = getParam(req, 'documentId');
  if (!documentId) {
    return res.status(400).json({
      error: 'documentId is required',
    });
  }
  
  try {
    const { deleteDocumentVectors } = await import('../services/vector-db.service');
    await deleteDocumentVectors(documentId);
    
    logger.info('Document vectors deleted', { documentId });
    
    return res.json({
      success: true,
      message: 'Document vectors deleted successfully',
    });
  } catch (error: any) {
    logger.error('Failed to delete document vectors', {
      documentId,
      error: error.message,
    });
    
    return res.status(500).json({
      error: 'Failed to delete document',
      details: error.message,
    });
  }
});

export default router;
