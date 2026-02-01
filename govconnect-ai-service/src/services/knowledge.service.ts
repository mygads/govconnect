import axios from 'axios';
import logger from '../utils/logger';
import { config } from '../config/env';
import { checkRequestStatus, searchServices } from '../clients/case-service.client';
import {
  retrieveContext,
  inferCategories,
} from './rag.service';
import { RAGContext } from '../types/embedding.types';

interface KnowledgeItem {
  id: string;
  title: string;
  content: string;
  category: string;
  keywords: string[];
}

interface KnowledgeSearchResult {
  data: KnowledgeItem[];
  total: number;
  context: string;
}

interface VillageProfileSummary {
  id?: string;
  name?: string | null;
  short_name?: string | null;
  address?: string | null;
  gmaps_url?: string | null;
}

type VillageListItem = { id: string; name: string; slug: string };
const villageSlugCache = new Map<string, string>();

export async function resolveVillageSlug(villageId?: string): Promise<string | null> {
  if (!villageId) return null;
  const cached = villageSlugCache.get(villageId);
  if (cached) return cached;

  try {
    const resp = await axios.get<{ success?: boolean; data?: VillageListItem[] }>(
      `${config.dashboardServiceUrl}/api/public/webchat/villages`,
      { timeout: 5000 }
    );

    const list = Array.isArray(resp.data?.data) ? resp.data.data : [];
    const found = list.find((v) => v?.id === villageId);
    if (found?.slug) {
      villageSlugCache.set(villageId, found.slug);
      return found.slug;
    }

    return null;
  } catch (error: any) {
    logger.warn('Failed to resolve village slug (graceful fallback)', {
      error: error?.message,
      villageId,
    });
    return null;
  }
}

// Feature flag for RAG-based search
const USE_RAG_SEARCH = process.env.USE_RAG_SEARCH !== 'false'; // Default: true

/**
 * Search knowledge base for relevant information
 * Uses RAG (semantic search) when enabled, falls back to keyword search
 */
export async function searchKnowledge(query: string, categories?: string[], villageId?: string): Promise<KnowledgeSearchResult> {
  try {
    logger.info('Searching knowledge base', {
      query: query.substring(0, 100),
      categories,
      villageId,
      useRAG: USE_RAG_SEARCH,
    });

    // Try RAG-based semantic search first
    if (USE_RAG_SEARCH) {
      try {
        const ragResult = await searchKnowledgeWithRAG(query, categories, villageId);
        if (ragResult.total > 0) {
          return ragResult;
        }
        // If RAG returns no results, fall back to keyword search
        logger.debug('RAG search returned no results, falling back to keyword search');
      } catch (ragError: any) {
        logger.warn('RAG search failed, falling back to keyword search', {
          error: ragError.message,
        });
      }
    }

    // Keyword-based search (fallback or when RAG is disabled)
    return await searchKnowledgeWithKeywords(query, categories, villageId);
  } catch (error: any) {
    logger.error('Failed to search knowledge base', {
      error: error.message,
    });

    // Return empty result on error
    return {
      data: [],
      total: 0,
      context: '',
    };
  }
}

function shouldFetchServiceContext(userQuery: string): boolean {
  const q = (userQuery || '').toLowerCase();
  // Heuristic keywords: user likely asking about layanan (syarat/biaya/cara buat)
  const triggers = [
    'syarat',
    'persyaratan',
    'berkas',
    'dokumen',
    'lampiran',
    'biaya',
    'tarif',
    'gratis',
    'bayar',
    'bikin',
    'buat',
    'mengurus',
    'urus',
    'pengajuan',
    'surat',
  ];

  return triggers.some((kw) => q.includes(kw));
}

function extractRequestCode(userQuery: string): string | null {
  const q = userQuery || '';
  const reqMatch = q.match(/REQ-\d+/i);
  if (reqMatch?.[0]) return reqMatch[0].toUpperCase();

  // Extra tolerance for current system IDs (optional)
  const layMatch = q.match(/LAY-\d{8}-\d+/i);
  if (layMatch?.[0]) return layMatch[0].toUpperCase();

  return null;
}

/**
 * Get real-time context from Case Service (hybrid context)
 * - Service info lookup by keyword (if user asks about syarat/biaya/bikin, etc.)
 * - Request status check (if user includes request code like REQ-123)
 */
export async function getRealTimeContext(
  userQuery: string,
  villageId?: string,
  phoneNumber?: string
): Promise<string> {
  const parts: string[] = [];

  try {
    const requestCode = extractRequestCode(userQuery);
    const wantServiceContext = shouldFetchServiceContext(userQuery);

    if (wantServiceContext && villageId) {
      const services = await searchServices(userQuery, villageId);
      if (services.length > 0) {
        const top = services[0];

        // Public form base URL should point to the public dashboard domain.
        // Fallback to govconnect.my.id (never localhost) to avoid sending non-clickable/dev links to citizens.
        const dashboardBaseUrl = (
          (config.dashboardPublicUrl || '').trim()
          || (process.env.PUBLIC_FORM_BASE_URL || '').trim()
          || 'http://govconnect.my.id'
        ).replace(/\/$/, '');
        const villageSlug =
          (await resolveVillageSlug(villageId))
          || (process.env.DEFAULT_VILLAGE_SLUG || '').trim()
          || 'desa';
        const directFormLink = top?.slug
          ? `${dashboardBaseUrl}/form/${encodeURIComponent(villageSlug)}/${encodeURIComponent(top.slug)}`
          : null;

        const formatted = services
          .slice(0, 10)
          .map((s) => {
            const duration = s.estimated_duration != null ? `${s.estimated_duration} menit` : '-';
            const cost = s.cost != null ? `${s.cost}` : '-';
            const requirements = (s.requirements || []).slice(0, 12).join('; ');
            return `- ${s.service_name} | slug=${s.slug} | aktif=${s.is_active ? 'ya' : 'tidak'} | estimasi=${duration} | biaya=${cost} | syarat=${requirements || '-'}`;
          })
          .join('\n');

        const headerLines = [
          'KONTEKS REAL-TIME LAYANAN (CASE SERVICE)',
          directFormLink ? `DIRECT_FORM_LINK: ${directFormLink}` : null,
        ].filter(Boolean).join('\n');

        parts.push(`${headerLines}\n${formatted}`);
      }
    }

    if (requestCode && phoneNumber) {
      const status = await checkRequestStatus(requestCode, phoneNumber);
      if (status) {
        parts.push(
          [
            'KONTEKS REAL-TIME STATUS PENGAJUAN (CASE SERVICE)',
            `request_code: ${requestCode}`,
            `status: ${status.status}`,
            `current_step: ${status.current_step}`,
            `last_updated: ${status.last_updated}`,
            status.notes ? `notes: ${status.notes}` : 'notes: -',
          ].join('\n')
        );
      } else {
        parts.push(
          [
            'KONTEKS REAL-TIME STATUS PENGAJUAN (CASE SERVICE)',
            `request_code: ${requestCode}`,
            'status: NOT_FOUND_OR_UNAVAILABLE',
          ].join('\n')
        );
      }
    }
  } catch (error: any) {
    logger.warn('Failed to build real-time context (graceful ignore)', {
      error: error?.message,
    });
  }

  return parts.length > 0 ? parts.join('\n\n') : '';
}

/**
 * Search knowledge base using RAG (semantic search with embeddings)
 * 
 * NOTE: minScore tuned to 0.55 for better recall with Indonesian language
 * Higher scores (0.65+) were too strict and missed relevant results
 */
async function searchKnowledgeWithRAG(query: string, categories?: string[], villageId?: string): Promise<KnowledgeSearchResult> {
  const inferredCategories = categories || inferCategories(query);
  
  const ragContext = await retrieveContext(query, {
    topK: 5,
    minScore: 0.55, // Lowered from 0.65 for better recall with Indonesian queries
    categories: inferredCategories.length > 0 ? inferredCategories : undefined,
    sourceTypes: ['knowledge', 'document'], // Search both knowledge and documents
    villageId,
  });

  if (ragContext.totalResults === 0) {
    return {
      data: [],
      total: 0,
      context: '',
    };
  }

  // Convert RAG results to KnowledgeItem format
  const items: KnowledgeItem[] = ragContext.relevantChunks.map(chunk => ({
    id: chunk.id,
    title: chunk.source,
    content: chunk.content,
    category: chunk.metadata?.category || 'general',
    keywords: chunk.metadata?.keywords || [],
  }));

  logger.info('RAG knowledge search completed', {
    resultsFound: ragContext.totalResults,
    topScore: ragContext.relevantChunks[0]?.score.toFixed(4),
    searchTimeMs: ragContext.searchTimeMs,
  });

  return {
    data: items,
    total: ragContext.totalResults,
    context: ragContext.contextString,
  };
}

/**
 * Search knowledge base using keyword-based API (fallback)
 */
async function searchKnowledgeWithKeywords(query: string, categories?: string[], villageId?: string): Promise<KnowledgeSearchResult> {
  const response = await axios.post<KnowledgeSearchResult>(
    `${config.dashboardServiceUrl}/api/internal/knowledge`,
    {
      query,
      categories,
      village_id: villageId,
      limit: 5,
    },
    {
      headers: {
        'x-internal-api-key': config.internalApiKey,
      },
      timeout: 5000,
    }
  );

  logger.info('Keyword knowledge search completed', {
    resultsFound: response.data.total,
  });

  return response.data;
}

/**
 * Get all active knowledge for building context
 */
export async function getAllKnowledge(villageId?: string): Promise<KnowledgeItem[]> {
  try {
    const response = await axios.get<{ data: KnowledgeItem[] }>(
      `${config.dashboardServiceUrl}/api/internal/knowledge`,
      {
        params: { limit: 50, village_id: villageId },
        headers: {
          'x-internal-api-key': config.internalApiKey,
        },
        timeout: 5000,
      }
    );

    return response.data.data;
  } catch (error: any) {
    logger.error('Failed to get all knowledge', {
      error: error.message,
    });

    return [];
  }
}

/**
 * Get RAG context directly for a query
 * Use this when you need the full RAG context object
 * 
 * NOTE: minScore tuned to 0.55 for better recall with Indonesian language
 */
export async function getRAGContext(query: string, categories?: string[], villageId?: string): Promise<RAGContext> {
  const inferredCategories = categories || inferCategories(query);
  
  return retrieveContext(query, {
    topK: 5,
    minScore: 0.55, // Lowered from 0.65 for better recall with Indonesian queries
    categories: inferredCategories.length > 0 ? inferredCategories : undefined,
    sourceTypes: ['knowledge', 'document'],
    villageId,
  });
}

/**
 * Get village profile summary directly from Dashboard DB
 * Use for greeting personalization (no embedding needed)
 */
export async function getVillageProfileSummary(villageId?: string): Promise<VillageProfileSummary | null> {
  if (!villageId) return null;

  try {
    const response = await axios.get<{ data: VillageProfileSummary | null }>(
      `${config.dashboardServiceUrl}/api/internal/village-profile`,
      {
        params: { village_id: villageId },
        headers: {
          'x-internal-api-key': config.internalApiKey,
        },
        timeout: 5000,
      }
    );

    return response.data.data || null;
  } catch (error: any) {
    logger.warn('Failed to get village profile summary', {
      error: error.message,
      villageId,
    });
    return null;
  }
}

/**
 * Get kelurahan information context for greetings
 * This fetches basic kelurahan info (nama, alamat) to personalize welcome message
 */
export async function getKelurahanInfoContext(villageId?: string): Promise<string> {
  try {
    logger.debug('Fetching kelurahan info for greeting');

    const profile = await getVillageProfileSummary(villageId);
    if (profile?.name) {
      const profileContext = [
        `Nama Desa/Kelurahan: ${profile.name || '-'}`,
        `Nama Singkat: ${profile.short_name || '-'}`,
        `Alamat: ${profile.address || '-'}`,
        `Google Maps: ${profile.gmaps_url || '-'}`,
      ].join('\n');

      logger.info('Using village profile for greeting context', {
        villageId,
        name: profile.name,
      });

      return `PROFIL DESA (DATABASE)\n${profileContext}`;
    }
    
    // Try RAG-based search with specific query for kelurahan info
    const ragContext = await retrieveContext('informasi kelurahan nama alamat', {
      topK: 3,
      minScore: 0.5, // Lower threshold to get basic info
      categories: ['informasi_umum', 'kontak'],
      sourceTypes: ['knowledge'],
      villageId,
    });

    if (ragContext.totalResults > 0 && ragContext.contextString) {
      logger.info('Found kelurahan info from RAG', {
        resultsFound: ragContext.totalResults,
      });
      return ragContext.contextString;
    }

    // Fallback: try to get from knowledge API
    const response = await axios.get<{ data: KnowledgeItem[] }>(
      `${config.dashboardServiceUrl}/api/internal/knowledge`,
      {
        params: { 
          category: 'informasi_umum',
          limit: 5,
          village_id: villageId,
        },
        headers: {
          'x-internal-api-key': config.internalApiKey,
        },
        timeout: 5000,
      }
    );

    const items = response.data.data || [];
    if (items.length > 0) {
      const contextParts = items.map(item => 
        `[${item.category.toUpperCase()}] ${item.title}\n${item.content}`
      );
      logger.info('Found kelurahan info from knowledge API', {
        itemsFound: items.length,
      });
      return contextParts.join('\n\n');
    }

    logger.debug('No kelurahan info found');
    return '';
  } catch (error: any) {
    logger.warn('Failed to get kelurahan info', {
      error: error.message,
    });
    return '';
  }
}
