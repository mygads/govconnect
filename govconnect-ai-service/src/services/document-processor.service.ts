/**
 * Document Processor Service for GovConnect AI
 * 
 * Handles text chunking for RAG system
 * Splits documents into optimal chunks for embedding and retrieval
 * 
 * Features:
 * - Smart sentence-aware chunking
 * - Overlapping chunks for better context
 * - Metadata extraction (sections, pages)
 */

import logger from '../utils/logger';
import {
  DocumentChunk,
  EmbeddedChunk,
  ChunkingConfig,
  SupportedMimeType,
} from '../types/embedding.types';
import { generateBatchEmbeddings } from './embedding.service';

// Default chunking configuration
const DEFAULT_CHUNK_SIZE = 1000;      // ~200-250 words
const DEFAULT_CHUNK_OVERLAP = 200;    // ~50 words overlap
const DEFAULT_MIN_CHUNK_SIZE = 200;   // Minimum chunk size (raised from 100 — very short chunks produce weak embeddings)
const MAX_SEMANTIC_CHUNK_SIZE = 1500; // Max size for semantic chunks

/**
 * Split text into optimal chunks for embedding
 * Uses sentence-aware splitting with overlap for better retrieval
 * 
 * @param text - The text to chunk
 * @param documentId - Parent document ID
 * @param config - Chunking configuration
 * @returns Array of document chunks
 */
export function chunkText(
  text: string,
  documentId: string,
  config: ChunkingConfig = {}
): DocumentChunk[] {
  const {
    chunkSize = DEFAULT_CHUNK_SIZE,
    chunkOverlap = DEFAULT_CHUNK_OVERLAP,
    minChunkSize = DEFAULT_MIN_CHUNK_SIZE,
    splitByParagraph = true,
    splitBySentence = true,
  } = config;

  logger.debug('Starting text chunking', {
    textLength: text.length,
    chunkSize,
    chunkOverlap,
    documentId,
  });

  // Clean and normalize text
  const cleanText = normalizeText(text);
  
  if (cleanText.length === 0) {
    logger.warn('Empty text after normalization', { documentId });
    return [];
  }

  // If text is small enough, return as single chunk
  if (cleanText.length <= chunkSize) {
    return [{
      id: generateChunkId(documentId, 0),
      documentId,
      content: cleanText,
      chunkIndex: 0,
    }];
  }

  const chunks: DocumentChunk[] = [];
  let currentPosition = 0;
  let chunkIndex = 0;

  // Split by paragraphs first if enabled
  let segments: string[];
  if (splitByParagraph) {
    segments = splitIntoParagraphs(cleanText);
  } else if (splitBySentence) {
    segments = splitIntoSentences(cleanText);
  } else {
    segments = [cleanText];
  }

  let currentChunk = '';
  let currentSegmentIndex = 0;

  for (const segment of segments) {
    // If adding this segment exceeds chunk size
    if (currentChunk.length + segment.length > chunkSize && currentChunk.length > 0) {
      // Save current chunk
      if (currentChunk.length >= minChunkSize) {
        chunks.push({
          id: generateChunkId(documentId, chunkIndex),
          documentId,
          content: currentChunk.trim(),
          chunkIndex,
        });
        chunkIndex++;
      }

      // Start new chunk with overlap from previous
      if (chunkOverlap > 0 && currentChunk.length > chunkOverlap) {
        // Get last N characters for overlap
        const overlapText = getOverlapText(currentChunk, chunkOverlap, splitBySentence);
        currentChunk = overlapText + ' ' + segment;
      } else {
        currentChunk = segment;
      }
    } else {
      // Add segment to current chunk
      currentChunk = currentChunk ? currentChunk + ' ' + segment : segment;
    }
  }

  // Don't forget the last chunk
  if (currentChunk.length >= minChunkSize) {
    chunks.push({
      id: generateChunkId(documentId, chunkIndex),
      documentId,
      content: currentChunk.trim(),
      chunkIndex,
    });
  }

  logger.info('Text chunking completed', {
    documentId,
    totalChunks: chunks.length,
    avgChunkSize: Math.round(cleanText.length / chunks.length),
  });

  return chunks;
}

/**
 * Process document and generate embeddings for all chunks
 * 
 * @param content - Document content
 * @param documentId - Document ID
 * @param config - Chunking configuration
 * @returns Array of chunks with embeddings
 */
export async function processDocumentWithEmbeddings(
  content: string,
  documentId: string,
  config: ChunkingConfig = {}
): Promise<EmbeddedChunk[]> {
  const startTime = Date.now();

  // Chunk the document
  const chunks = chunkText(content, documentId, config);

  if (chunks.length === 0) {
    logger.warn('No chunks generated from document', { documentId });
    return [];
  }

  logger.info('Generating embeddings for document chunks', {
    documentId,
    chunkCount: chunks.length,
  });

  // Extract texts for batch embedding
  const texts = chunks.map(c => c.content);

  // Generate embeddings in batch
  const batchResult = await generateBatchEmbeddings(texts, {
    taskType: 'RETRIEVAL_DOCUMENT',
    outputDimensionality: 768,
  });

  // Combine chunks with embeddings
  const embeddedChunks: EmbeddedChunk[] = chunks.map((chunk, idx) => ({
    ...chunk,
    embedding: batchResult.embeddings[idx].values,
    embeddingModel: batchResult.embeddings[idx].model,
    embeddingDimensions: batchResult.embeddings[idx].dimensions,
  }));

  const endTime = Date.now();
  logger.info('Document processing completed', {
    documentId,
    chunkCount: embeddedChunks.length,
    processingTimeMs: endTime - startTime,
  });

  return embeddedChunks;
}

/**
 * Split text by sections/headers
 * Useful for structured documents
 */
export function extractSections(text: string): Array<{ title: string; content: string }> {
  const sections: Array<{ title: string; content: string }> = [];
  
  // Match common header patterns
  const headerPatterns = [
    /^#{1,6}\s+(.+)$/gm,                    // Markdown headers
    /^([A-Z][A-Z\s]+):?\s*$/gm,             // ALL CAPS headers
    /^(\d+\.?\s+[A-Z][a-z]+.*)$/gm,         // Numbered headers
    /^([A-Z][a-z]+(?:\s+[A-Z][a-z]+)*):$/gm, // Title Case headers with colon
  ];

  let lastIndex = 0;
  let currentTitle = 'Introduction';
  let matches: Array<{ index: number; title: string }> = [];

  // Find all headers
  for (const pattern of headerPatterns) {
    let match;
    while ((match = pattern.exec(text)) !== null) {
      matches.push({
        index: match.index,
        title: match[1].trim(),
      });
    }
  }

  // Sort by index
  matches.sort((a, b) => a.index - b.index);

  // Extract sections
  for (let i = 0; i < matches.length; i++) {
    const current = matches[i];
    const next = matches[i + 1];
    
    if (current.index > lastIndex) {
      // Content before first header
      const beforeContent = text.slice(lastIndex, current.index).trim();
      if (beforeContent) {
        sections.push({
          title: currentTitle,
          content: beforeContent,
        });
      }
    }

    currentTitle = current.title;
    const endIndex = next ? next.index : text.length;
    const sectionContent = text.slice(current.index + current.title.length, endIndex).trim();
    
    if (sectionContent) {
      sections.push({
        title: currentTitle,
        content: sectionContent,
      });
    }

    lastIndex = endIndex;
  }

  // Handle case with no headers
  if (sections.length === 0 && text.trim()) {
    sections.push({
      title: 'Content',
      content: text.trim(),
    });
  }

  return sections;
}

/**
 * Clean and normalize text
 */
function normalizeText(text: string): string {
  return text
    // Normalize whitespace
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    // Remove excessive newlines
    .replace(/\n{3,}/g, '\n\n')
    // Remove excessive spaces
    .replace(/[ \t]+/g, ' ')
    // Trim each line
    .split('\n')
    .map(line => line.trim())
    .join('\n')
    // Final trim
    .trim();
}

/**
 * Split text into paragraphs
 */
function splitIntoParagraphs(text: string): string[] {
  return text
    .split(/\n\n+/)
    .map(p => p.trim())
    .filter(p => p.length > 0);
}

/**
 * Split text into sentences
 */
function splitIntoSentences(text: string): string[] {
  // Handle common abbreviations to avoid false splits
  const protectedText = text
    .replace(/([Dd]r|[Mm]r|[Mm]rs|[Mm]s|[Pp]rof|[Jj]r|[Ss]r)\./g, '$1<DOT>')
    .replace(/([A-Z])\./g, '$1<DOT>')  // Single letter abbreviations
    .replace(/(\d)\./g, '$1<DOT>');     // Numbers with periods

  // Split by sentence-ending punctuation
  const sentences = protectedText
    .split(/(?<=[.!?])\s+/)
    .map(s => s.replace(/<DOT>/g, '.').trim())
    .filter(s => s.length > 0);

  return sentences;
}

/**
 * Get overlap text from the end of a chunk
 * Tries to end at sentence boundary
 */
function getOverlapText(text: string, targetLength: number, sentenceAware: boolean): string {
  if (!sentenceAware) {
    return text.slice(-targetLength);
  }

  // Find sentence boundaries in the last portion
  const lastPortion = text.slice(-targetLength * 2);
  const sentences = splitIntoSentences(lastPortion);
  
  if (sentences.length <= 1) {
    return text.slice(-targetLength);
  }

  // Build overlap from last sentences
  let overlap = '';
  for (let i = sentences.length - 1; i >= 0; i--) {
    const newOverlap = sentences[i] + (overlap ? ' ' + overlap : '');
    if (newOverlap.length <= targetLength || overlap === '') {
      overlap = newOverlap;
    } else {
      break;
    }
  }

  return overlap;
}

/**
 * Generate unique chunk ID
 */
function generateChunkId(documentId: string, chunkIndex: number): string {
  return `${documentId}_chunk_${chunkIndex.toString().padStart(4, '0')}`;
}

/**
 * Estimate token count for text (rough estimate)
 * Gemini uses ~4 characters per token on average
 */
export function estimateTokenCount(text: string): number {
  return Math.ceil(text.length / 4);
}

/**
 * Check if file type is supported
 */
export function isSupportedMimeType(mimeType: string): mimeType is SupportedMimeType {
  const supported: string[] = [
    'application/pdf',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    'application/vnd.ms-powerpoint',
    'text/plain',
    'text/markdown',
    'text/csv',
  ];
  return supported.includes(mimeType);
}

/**
 * Get file extension from MIME type
 */
export function getExtensionFromMimeType(mimeType: SupportedMimeType): string {
  const mimeMap: Record<SupportedMimeType, string> = {
    'application/pdf': 'pdf',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx',
    'application/msword': 'doc',
    'application/vnd.openxmlformats-officedocument.presentationml.presentation': 'pptx',
    'application/vnd.ms-powerpoint': 'ppt',
    'text/plain': 'txt',
    'text/markdown': 'md',
    'text/csv': 'csv',
  };
  return mimeMap[mimeType] || 'txt';
}

/**
 * ==================== SEMANTIC CHUNKING ====================
 * Improved chunking strategy that respects document structure
 */

interface SemanticChunk {
  content: string;
  chunkIndex: number;
  metadata: {
    type: 'paragraph' | 'section' | 'list' | 'table' | 'code';
    sectionTitle?: string;
    hasHeading?: boolean;
  };
}

/**
 * Semantic chunking berdasarkan paragraph/section
 * Lebih baik daripada fixed-size chunking untuk document understanding
 */
export function semanticChunking(
  text: string,
  documentId: string,
  maxChunkSize: number = MAX_SEMANTIC_CHUNK_SIZE
): DocumentChunk[] {
  logger.debug('Starting semantic chunking', {
    textLength: text.length,
    maxChunkSize,
    documentId,
  });

  const cleanText = normalizeText(text);
  
  if (cleanText.length === 0) {
    return [];
  }

  // If text is small enough, return as single chunk
  if (cleanText.length <= maxChunkSize) {
    return [{
      id: generateChunkId(documentId, 0),
      documentId,
      content: cleanText,
      chunkIndex: 0,
      metadata: { type: 'paragraph' },
    }];
  }

  const semanticChunks: SemanticChunk[] = [];
  
  // Step 1: Try to split by sections first (headers)
  const sections = extractSections(cleanText);
  
  if (sections.length > 1) {
    // Process each section
    let chunkIndex = 0;
    for (const section of sections) {
      const sectionChunks = chunkSection(section.content, section.title, maxChunkSize, chunkIndex);
      semanticChunks.push(...sectionChunks);
      chunkIndex += sectionChunks.length;
    }
  } else {
    // No sections found, split by paragraphs
    const paragraphs = splitIntoParagraphs(cleanText);
    let currentChunk = '';
    let chunkIndex = 0;
    
    for (const para of paragraphs) {
      // Check if paragraph itself is too large
      if (para.length > maxChunkSize) {
        // Save current chunk first
        if (currentChunk.trim()) {
          semanticChunks.push({
            content: currentChunk.trim(),
            chunkIndex: chunkIndex++,
            metadata: { type: 'paragraph' },
          });
          currentChunk = '';
        }
        
        // Split large paragraph by sentences
        const sentenceChunks = splitLargeParagraph(para, maxChunkSize, chunkIndex);
        semanticChunks.push(...sentenceChunks);
        chunkIndex += sentenceChunks.length;
        continue;
      }
      
      // If adding this paragraph exceeds limit, save current and start new
      if (currentChunk.length + para.length + 2 > maxChunkSize && currentChunk.length > 0) {
        semanticChunks.push({
          content: currentChunk.trim(),
          chunkIndex: chunkIndex++,
          metadata: { type: 'paragraph' },
        });
        currentChunk = para;
      } else {
        currentChunk = currentChunk ? currentChunk + '\n\n' + para : para;
      }
    }
    
    // Don't forget last chunk
    if (currentChunk.trim()) {
      semanticChunks.push({
        content: currentChunk.trim(),
        chunkIndex: chunkIndex++,
        metadata: { type: 'paragraph' },
      });
    }
  }

  // Convert to DocumentChunk format
  const documentChunks: DocumentChunk[] = semanticChunks.map((chunk, idx) => ({
    id: generateChunkId(documentId, idx),
    documentId,
    content: chunk.content,
    chunkIndex: idx,
    sectionTitle: chunk.metadata.sectionTitle,
    metadata: chunk.metadata,
  }));

  logger.info('Semantic chunking completed', {
    documentId,
    totalChunks: documentChunks.length,
    avgChunkSize: Math.round(cleanText.length / documentChunks.length),
    method: sections.length > 1 ? 'section-based' : 'paragraph-based',
  });

  return documentChunks;
}

/**
 * Chunk a section while preserving its title context
 */
function chunkSection(
  content: string,
  sectionTitle: string,
  maxChunkSize: number,
  startIndex: number
): SemanticChunk[] {
  const chunks: SemanticChunk[] = [];
  const paragraphs = splitIntoParagraphs(content);
  
  let currentChunk = '';
  let chunkIndex = startIndex;
  
  for (const para of paragraphs) {
    // Check if paragraph itself is too large
    if (para.length > maxChunkSize) {
      if (currentChunk.trim()) {
        chunks.push({
          content: currentChunk.trim(),
          chunkIndex: chunkIndex++,
          metadata: { 
            type: 'section', 
            sectionTitle,
            hasHeading: chunks.length === 0,
          },
        });
        currentChunk = '';
      }
      
      const sentenceChunks = splitLargeParagraph(para, maxChunkSize, chunkIndex);
      for (const sc of sentenceChunks) {
        sc.metadata.sectionTitle = sectionTitle;
      }
      chunks.push(...sentenceChunks);
      chunkIndex += sentenceChunks.length;
      continue;
    }
    
    if (currentChunk.length + para.length + 2 > maxChunkSize && currentChunk.length > 0) {
      chunks.push({
        content: currentChunk.trim(),
        chunkIndex: chunkIndex++,
        metadata: { 
          type: 'section', 
          sectionTitle,
          hasHeading: chunks.length === 0,
        },
      });
      currentChunk = para;
    } else {
      currentChunk = currentChunk ? currentChunk + '\n\n' + para : para;
    }
  }
  
  if (currentChunk.trim()) {
    chunks.push({
      content: currentChunk.trim(),
      chunkIndex: chunkIndex++,
      metadata: { 
        type: 'section', 
        sectionTitle,
        hasHeading: chunks.length === 0,
      },
    });
  }
  
  return chunks;
}

/**
 * Split a large paragraph by sentences
 */
function splitLargeParagraph(
  paragraph: string,
  maxChunkSize: number,
  startIndex: number
): SemanticChunk[] {
  const chunks: SemanticChunk[] = [];
  const sentences = splitIntoSentences(paragraph);
  
  let currentChunk = '';
  let chunkIndex = startIndex;
  
  for (const sentence of sentences) {
    if (currentChunk.length + sentence.length + 1 > maxChunkSize && currentChunk.length > 0) {
      chunks.push({
        content: currentChunk.trim(),
        chunkIndex: chunkIndex++,
        metadata: { type: 'paragraph' },
      });
      currentChunk = sentence;
    } else {
      currentChunk = currentChunk ? currentChunk + ' ' + sentence : sentence;
    }
  }
  
  if (currentChunk.trim()) {
    chunks.push({
      content: currentChunk.trim(),
      chunkIndex: chunkIndex++,
      metadata: { type: 'paragraph' },
    });
  }
  
  return chunks;
}

/**
 * Process document using semantic chunking
 * This is the recommended method for better RAG performance
 */
export async function processDocumentSemanticChunking(
  content: string,
  documentId: string,
  maxChunkSize: number = MAX_SEMANTIC_CHUNK_SIZE
): Promise<EmbeddedChunk[]> {
  const startTime = Date.now();

  // Use semantic chunking
  const chunks = semanticChunking(content, documentId, maxChunkSize);

  if (chunks.length === 0) {
    logger.warn('No chunks generated from document', { documentId });
    return [];
  }

  logger.info('Generating embeddings for semantic chunks', {
    documentId,
    chunkCount: chunks.length,
  });

  // Extract texts for batch embedding
  // BEST PRACTICE: Prepend section title to each chunk's embedding input.
  // This gives the embedding model more context about what the chunk is about,
  // dramatically improving retrieval accuracy for section-specific queries.
  // The stored content remains unchanged — only the embedding input is enriched.
  const texts = chunks.map(c => {
    const prefix = c.sectionTitle || c.metadata?.sectionTitle;
    return prefix ? `${prefix}\n${c.content}` : c.content;
  });

  // Generate embeddings in batch
  const batchResult = await generateBatchEmbeddings(texts, {
    taskType: 'RETRIEVAL_DOCUMENT',
    outputDimensionality: 768,
  });

  // Combine chunks with embeddings
  const embeddedChunks: EmbeddedChunk[] = chunks.map((chunk, idx) => ({
    ...chunk,
    embedding: batchResult.embeddings[idx].values,
    embeddingModel: batchResult.embeddings[idx].model,
    embeddingDimensions: batchResult.embeddings[idx].dimensions,
  }));

  const endTime = Date.now();
  logger.info('Semantic document processing completed', {
    documentId,
    chunkCount: embeddedChunks.length,
    processingTimeMs: endTime - startTime,
    method: 'semantic',
  });

  return embeddedChunks;
}
