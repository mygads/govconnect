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
import { processDocumentWithEmbeddings } from '../services/document-processor.service';
import { addDocumentChunks } from '../services/vector-db.service';
import { config } from '../config/env';

const router = Router();

// Configure multer for file uploads
const uploadDir = path.join(process.cwd(), 'uploads', 'documents');

// Ensure upload directory exists
if (!existsSync(uploadDir)) {
  mkdirSync(uploadDir, { recursive: true });
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
      'text/plain',
      'text/markdown',
      'text/csv',
    ];
    
    if (allowedTypes.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error('File type not supported. Allowed: PDF, DOCX, DOC, TXT, MD, CSV'));
    }
  }
});

// Internal API key verification middleware
function verifyInternalKey(req: Request, res: Response, next: Function) {
  const apiKey = req.headers['x-internal-api-key'];
  
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
  
  if (mimeType.includes('wordprocessingml') || mimeType === 'application/msword') {
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
  
  throw new Error(`Unsupported file type: ${mimeType}`);
}

/**
 * POST /api/upload/document
 * Upload and process a document
 */
router.post('/document', verifyInternalKey, upload.single('file'), async (req: Request, res: Response) => {
  const file = req.file;
  const { documentId, title, category } = req.body;
  
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
    
    // Process document with embeddings
    const embeddedChunks = await processDocumentWithEmbeddings(content, documentId, {
      chunkSize: 1000,
      chunkOverlap: 200,
    });
    
    if (embeddedChunks.length === 0) {
      await fs.unlink(file.path).catch(() => {});
      return res.status(400).json({ error: 'No chunks generated from document' });
    }
    
    // Store chunks with embeddings to vector DB
    await addDocumentChunks(embeddedChunks.map((chunk, idx) => ({
      documentId,
      chunkIndex: idx,
      content: chunk.content,
      embedding: chunk.embedding,
      documentTitle: title || file.originalname,
      category: category || 'general',
      pageNumber: chunk.pageNumber,
      sectionTitle: chunk.sectionTitle,
    })));
    
    logger.info('Document processing completed', {
      documentId,
      chunksCount: embeddedChunks.length,
      filename: file.filename,
    });
    
    return res.json({
      success: true,
      documentId,
      filename: file.filename,
      originalName: file.originalname,
      fileSize: file.size,
      mimeType: file.mimetype,
      chunksCount: embeddedChunks.length,
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
  const { documentId } = req.params;
  
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
