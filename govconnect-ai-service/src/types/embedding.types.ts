/**
 * Embedding Types for GovConnect AI Service
 * Based on Gemini Embedding API (gemini-embedding-001)
 * 
 * @see https://ai.google.dev/gemini-api/docs/embeddings
 */

/**
 * Task types supported by Gemini Embedding API
 * Each task type optimizes embeddings for specific use cases
 */
export type EmbeddingTaskType = 
  | 'SEMANTIC_SIMILARITY'   // For comparing similarity between texts
  | 'CLASSIFICATION'        // For text classification tasks
  | 'CLUSTERING'            // For grouping similar texts
  | 'RETRIEVAL_DOCUMENT'    // For indexing documents (use for knowledge base)
  | 'RETRIEVAL_QUERY'       // For search queries (use for user questions)
  | 'QUESTION_ANSWERING'    // For QA systems - questions
  | 'FACT_VERIFICATION';    // For fact-checking statements

/**
 * Supported output dimensionality for embeddings
 * Lower dimensions = smaller storage, slightly lower quality
 * Recommended: 768 (best balance), 1536, or 3072 (highest quality)
 */
export type EmbeddingDimension = 128 | 256 | 512 | 768 | 1536 | 2048 | 3072;

/**
 * Result from embedding generation
 */
export interface EmbeddingResult {
  values: number[];           // The embedding vector
  dimensions: number;         // Actual dimensions of the vector
  model: string;              // Model used (e.g., "gemini-embedding-001")
  normalized: boolean;        // Whether the embedding is L2-normalized
}

/**
 * Batch embedding result
 */
export interface BatchEmbeddingResult {
  embeddings: EmbeddingResult[];
  totalTokens?: number;
  processingTimeMs: number;
}

/**
 * Configuration for embedding operations
 */
export interface EmbeddingConfig {
  model?: string;                           // Default: gemini-embedding-001
  outputDimensionality?: EmbeddingDimension; // Default: 768
  taskType?: EmbeddingTaskType;              // Default: RETRIEVAL_DOCUMENT
  normalize?: boolean;                       // Default: true for dims < 3072
  useCache?: boolean;                        // Default: true for RETRIEVAL_QUERY
}

/**
 * Document chunk for RAG system
 */
export interface DocumentChunk {
  id: string;
  documentId: string;
  content: string;
  chunkIndex: number;
  pageNumber?: number;
  sectionTitle?: string;
  metadata?: Record<string, any>;
}

/**
 * Document chunk with embedding
 */
export interface EmbeddedChunk extends DocumentChunk {
  embedding: number[];
  embeddingModel: string;
  embeddingDimensions: number;
}

/**
 * Knowledge base item with embedding
 */
export interface EmbeddedKnowledge {
  id: string;
  title: string;
  content: string;
  category: string;
  keywords: string[];
  embedding: number[];
  embeddingModel: string;
  embeddingDimensions: number;
  lastEmbedded: Date;
}

/**
 * Vector search result
 */
export interface VectorSearchResult {
  id: string;
  content: string;
  score: number;              // Similarity score (0-1 for cosine)
  source: string;             // Source identifier (knowledge_id or document_id)
  sourceType: 'knowledge' | 'document';
  metadata?: Record<string, any>;
}

/**
 * Vector search options
 */
export interface VectorSearchOptions {
  topK?: number;              // Number of results to return (default: 5)
  minScore?: number;          // Minimum similarity threshold (default: 0.7)
  categories?: string[];      // Filter by categories
  sourceTypes?: ('knowledge' | 'document')[];  // Filter by source type
  villageId?: string;         // Scope results by village
}

/**
 * RAG context result
 */
export interface RAGContext {
  relevantChunks: VectorSearchResult[];
  contextString: string;      // Formatted context for LLM prompt
  totalResults: number;
  searchTimeMs: number;
  confidence?: RAGConfidence; // Confidence scoring for the result
}

/**
 * RAG confidence scoring
 */
export interface RAGConfidence {
  level: 'high' | 'medium' | 'low' | 'none';  // Confidence level
  score: number;              // 0-1 confidence score
  reason: string;             // Human-readable explanation
  suggestFallback: boolean;   // Should the LLM use general knowledge?
}

/**
 * Document processing status
 */
export type DocumentStatus = 'pending' | 'processing' | 'completed' | 'failed';

/**
 * Supported document MIME types
 */
export type SupportedMimeType = 
  | 'application/pdf'
  | 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'  // DOCX
  | 'application/msword'     // DOC
  | 'text/plain'
  | 'text/markdown'
  | 'text/csv';

/**
 * Document metadata
 */
export interface DocumentMetadata {
  id: string;
  filename: string;
  originalName: string;
  mimeType: SupportedMimeType;
  fileSize: number;
  fileUrl: string;
  title?: string;
  description?: string;
  category?: string;
  status: DocumentStatus;
  errorMessage?: string;
  totalChunks?: number;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Chunking configuration
 */
export interface ChunkingConfig {
  chunkSize?: number;         // Target characters per chunk (default: 1000)
  chunkOverlap?: number;      // Overlap between chunks (default: 200)
  minChunkSize?: number;      // Minimum chunk size (default: 100)
  splitByParagraph?: boolean; // Try to split by paragraph first (default: true)
  splitBySentence?: boolean;  // Try to split by sentence (default: true)
}

/**
 * Embedding service statistics
 */
export interface EmbeddingStats {
  totalEmbeddingsGenerated: number;
  totalTokensUsed: number;
  averageLatencyMs: number;
  lastEmbeddingAt?: Date;
  errorCount: number;
  successRate: number;
}
