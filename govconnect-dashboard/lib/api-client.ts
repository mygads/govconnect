/**
 * API Client - Multi-Service Direct Connection
 * 
 * Dashboard berkomunikasi langsung ke masing-masing backend service
 * untuk internal Docker network communication.
 * 
 * ROUTING:
 * ┌─────────────────────────────────────────────────────────────────────────────────┐
 * │  Direct Service URLs (Internal Docker Network)                                 │
 * │  ─────────────────────────────────────────────────────────────────────────────  │
 * │  CHANNEL_SERVICE_URL  → Channel Service (WhatsApp, Messages)                   │
 * │  AI_SERVICE_URL       → AI Service (Knowledge, Documents, Embeddings)          │
 * │  CASE_SERVICE_URL     → Case Service (Laporan, Layanan, Statistics)            │
 * │  NOTIFICATION_SERVICE_URL → Notification Service                               │
 * └─────────────────────────────────────────────────────────────────────────────────┘
 * 
 * ENVIRONMENT:
 * - Docker: Direct service URLs (http://channel-service:3001, etc.)
 * - Fallback: API_BASE_URL with path prefix (for backward compatibility)
 */

// Service URLs - Direct connection to each service
// Use bracket access so values are read at runtime in Next standalone builds.
export const CHANNEL_SERVICE_URL = process.env['CHANNEL_SERVICE_URL'] || '';
export const AI_SERVICE_URL = process.env['AI_SERVICE_URL'] || '';
export const CASE_SERVICE_URL = process.env['CASE_SERVICE_URL'] || '';
export const NOTIFICATION_SERVICE_URL = process.env['NOTIFICATION_SERVICE_URL'] || '';

// Fallback to single endpoint (backward compatibility)
export const API_BASE_URL = process.env['API_BASE_URL'] || '';

// SEC-06 fix: No hardcoded fallback — throw in production, warn in dev
let _internalApiKey: string | null = null;
let _internalApiKeyWarned = false;

export function getInternalApiKey(): string {
  if (_internalApiKey !== null) return _internalApiKey;

  const keyValue = process.env['INTERNAL_API_KEY']?.trim() || '';
  if (!keyValue) {
    if (process.env.NODE_ENV === 'production') {
      throw new Error('INTERNAL_API_KEY is required in production');
    }
    if (!_internalApiKeyWarned) {
      console.warn('WARNING: INTERNAL_API_KEY not set — internal service routes may fail until runtime env is injected');
      _internalApiKeyWarned = true;
    }
  }
  _internalApiKey = keyValue;
  return _internalApiKey;
}

export function requireInternalApiKey(): string {
  const keyValue = getInternalApiKey().trim()
  if (!keyValue) {
    throw new Error('INTERNAL_API_KEY is required for public proxy routes')
  }
  return keyValue
}

// For backward compatibility - keep this as a plain runtime-read constant
// so module evaluation during `next build` does not fail before env injection.
export const INTERNAL_API_KEY = process.env['INTERNAL_API_KEY'] || '';

// Auth token storage
let authToken: string | null = null;

// Service path prefixes (for fallback mode)
export const ServicePath = {
  CHANNEL: '/channel',
  AI: '/ai',
  CASE: '/case',
  NOTIFICATION: '/notification',
} as const;

export type ServicePathType = typeof ServicePath[keyof typeof ServicePath];

// Map service path to direct URL
const serviceUrlMap: Record<ServicePathType, string> = {
  '/channel': CHANNEL_SERVICE_URL,
  '/ai': AI_SERVICE_URL,
  '/case': CASE_SERVICE_URL,
  '/notification': NOTIFICATION_SERVICE_URL,
};

function normalizeBaseUrl(name: string, value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed) return null;

  try {
    const parsed = new URL(trimmed);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      throw new Error('URL must use http or https');
    }
    return parsed.toString().replace(/\/$/, '');
  } catch (error: any) {
    const message = `${name} is invalid: ${error.message}`;
    if (process.env.NODE_ENV === 'production') {
      throw new Error(message);
    }
    console.warn(message);
    return null;
  }
}

/**
 * Build full URL untuk service
 * Prioritas: Direct service URL > API_BASE_URL with path prefix
 */
export function buildUrl(service: ServicePathType, path: string): string {
  // Pastikan path dimulai dengan /
  const normalizedPath = path.startsWith('/') ? path : `/${path}`;
  const directUrl = normalizeBaseUrl(`${service} service URL`, serviceUrlMap[service]);
  if (directUrl) {
    return new URL(normalizedPath, `${directUrl}/`).toString();
  }

  const fallbackUrl = normalizeBaseUrl('API_BASE_URL', API_BASE_URL);
  if (fallbackUrl) {
    return new URL(`${service}${normalizedPath}`, `${fallbackUrl}/`).toString();
  }

  if (process.env.NODE_ENV === 'production') {
    throw new Error(`Missing service URL for ${service}; configure direct service URL or API_BASE_URL`);
  }

  return `${service}${normalizedPath}`;
}

/**
 * Get headers dengan internal API key
 */
export function getHeaders(additionalHeaders?: Record<string, string>): Record<string, string> {
  return {
    'Content-Type': 'application/json',
    'x-internal-api-key': getInternalApiKey(),
    ...additionalHeaders,
  };
}

/**
 * Fetch dengan timeout dan error handling
 */
export async function apiFetch(
  url: string,
  options: RequestInit & { timeout?: number } = {}
): Promise<Response> {
  const { timeout = 30000, ...fetchOptions } = options;
  
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeout);
  
  try {
    const response = await fetch(url, {
      ...fetchOptions,
      signal: controller.signal,
    });
    return response;
  } finally {
    clearTimeout(timeoutId);
  }
}

// ==================== CASE SERVICE ====================
export const caseService = {
  /**
   * Get laporan list
   */
  async getLaporan(params?: { status?: string; search?: string; limit?: string; offset?: string; village_id?: string }) {
    const url = new URL(buildUrl(ServicePath.CASE, '/laporan'));
    if (params?.status) url.searchParams.set('status', params.status);
    if (params?.search) url.searchParams.set('search', params.search);
    if (params?.limit) url.searchParams.set('limit', params.limit);
    if (params?.offset) url.searchParams.set('offset', params.offset);
    if (params?.village_id) url.searchParams.set('village_id', params.village_id);
    
    return apiFetch(url.toString(), {
      headers: getHeaders(),
    });
  },

  async getRealtimeComplaintSummary(village_id?: string) {
    const url = new URL(buildUrl(ServicePath.CASE, '/laporan/realtime-summary'));
    if (village_id) url.searchParams.set('village_id', village_id);
    return apiFetch(url.toString(), {
      headers: getHeaders(),
    });
  },

  /**
   * Get laporan by ID
   */
  async getLaporanById(id: string, village_id?: string) {
    const url = new URL(buildUrl(ServicePath.CASE, `/laporan/${id}`));
    if (village_id) {
      url.searchParams.set('village_id', village_id);
    }
    return apiFetch(url.toString(), {
      headers: getHeaders(),
    });
  },

  /**
   * Update laporan status
   */
  async updateLaporanStatus(id: string, data: { status: string; admin_notes?: string }, village_id?: string) {
    const url = new URL(buildUrl(ServicePath.CASE, `/laporan/${id}/status`));
    if (village_id) {
      url.searchParams.set('village_id', village_id);
    }
    return apiFetch(url.toString(), {
      method: 'PATCH',
      headers: getHeaders(),
      body: JSON.stringify(data),
    });
  },

  /**
   * Soft delete laporan
   */
  async softDeleteLaporan(id: string, village_id?: string, auditHeaders?: Record<string, string>) {
    const url = new URL(buildUrl(ServicePath.CASE, `/laporan/${id}/soft-delete`));
    if (village_id) url.searchParams.set('village_id', village_id);
    return apiFetch(url.toString(), {
      method: 'PATCH',
      headers: getHeaders(auditHeaders),
    });
  },

  /**
   * Restore soft-deleted laporan
   */
  async restoreLaporan(id: string, village_id?: string, auditHeaders?: Record<string, string>) {
    const url = new URL(buildUrl(ServicePath.CASE, `/laporan/${id}/restore`));
    if (village_id) url.searchParams.set('village_id', village_id);
    return apiFetch(url.toString(), {
      method: 'PATCH',
      headers: getHeaders(auditHeaders),
    });
  },

  /**
   * Get deleted laporan
   */
  async getDeletedLaporan(village_id?: string) {
    const url = new URL(buildUrl(ServicePath.CASE, '/laporan/deleted'));
    if (village_id) url.searchParams.set('village_id', village_id);
    return apiFetch(url.toString(), {
      headers: getHeaders(),
    });
  },

  /**
   * Soft delete service request
   */
  async softDeleteServiceRequest(id: string, village_id?: string, auditHeaders?: Record<string, string>) {
    const url = new URL(buildUrl(ServicePath.CASE, `/service-requests/${id}/soft-delete`));
    if (village_id) url.searchParams.set('village_id', village_id);
    return apiFetch(url.toString(), {
      method: 'PATCH',
      headers: getHeaders(auditHeaders),
    });
  },

  /**
   * Restore soft-deleted service request
   */
  async restoreServiceRequest(id: string, village_id?: string, auditHeaders?: Record<string, string>) {
    const url = new URL(buildUrl(ServicePath.CASE, `/service-requests/${id}/restore`));
    if (village_id) url.searchParams.set('village_id', village_id);
    return apiFetch(url.toString(), {
      method: 'PATCH',
      headers: getHeaders(auditHeaders),
    });
  },

  /**
   * Get deleted service requests
   */
  async getDeletedServiceRequests(village_id?: string) {
    const url = new URL(buildUrl(ServicePath.CASE, '/service-requests/deleted'));
    if (village_id) url.searchParams.set('village_id', village_id);
    return apiFetch(url.toString(), {
      headers: getHeaders(),
    });
  },

  /**
   * Get service request list
   */
  async getServiceRequests(params?: { status?: string; limit?: string; offset?: string; village_id?: string }) {
    const url = new URL(buildUrl(ServicePath.CASE, '/service-requests'));
    if (params?.status) url.searchParams.set('status', params.status);
    if (params?.limit) url.searchParams.set('limit', params.limit);
    if (params?.offset) url.searchParams.set('offset', params.offset);
    if (params?.village_id) url.searchParams.set('village_id', params.village_id);

    return apiFetch(url.toString(), {
      headers: getHeaders(),
    });
  },

  /**
   * Get service request by ID
   */
  async getServiceRequestById(id: string, village_id?: string) {
    const url = new URL(buildUrl(ServicePath.CASE, `/service-requests/${id}`));
    if (village_id) url.searchParams.set('village_id', village_id);
    return apiFetch(url.toString(), {
      headers: getHeaders(),
    });
  },

  /**
   * Update service request status or editable admin fields
   */
  async updateServiceRequestStatus(
    id: string,
    data: {
      status?: string;
      admin_notes?: string | null;
      result_file_url?: string | null;
      result_file_name?: string | null;
      result_description?: string | null;
    },
    village_id?: string,
  ) {
    const url = new URL(buildUrl(ServicePath.CASE, `/service-requests/${id}/status`));
    if (village_id) url.searchParams.set('village_id', village_id);
    return apiFetch(url.toString(), {
      method: 'PATCH',
      headers: getHeaders(),
      body: JSON.stringify(data),
    });
  },

  /**
   * Get statistics overview
   */
  async getOverview(params?: { village_id?: string }) {
    const url = new URL(buildUrl(ServicePath.CASE, '/statistics/overview'));
    if (params?.village_id) url.searchParams.set('village_id', params.village_id);
    
    return apiFetch(url.toString(), {
      headers: getHeaders(),
      timeout: 25000,
    });
  },

  /**
   * Get statistics trends
   */
  async getTrends(period: string = 'weekly', village_id?: string) {
    const url = new URL(buildUrl(ServicePath.CASE, '/statistics/trends'));
    url.searchParams.set('period', period);
    if (village_id) url.searchParams.set('village_id', village_id);
    
    return apiFetch(url.toString(), {
      headers: getHeaders(),
    });
  },
};

// ==================== AI SERVICE ====================
export const ai = {
  /**
   * Add knowledge vector
   */
  async addKnowledge(data: {
    id: string;
    village_id?: string;
    title: string;
    content: string;
    category: string;
    keywords: string[];
    qualityScore?: number;
    scope?: string;
    is_global?: boolean;
  }) {
    return apiFetch(buildUrl(ServicePath.AI, '/api/knowledge'), {
      method: 'POST',
      headers: getHeaders(),
      body: JSON.stringify(data),
    });
  },

  /**
   * Update knowledge vector
   */
  async updateKnowledge(id: string, data: {
    village_id?: string;
    title: string;
    content: string;
    category: string;
    keywords: string[];
    qualityScore?: number;
    scope?: string;
    is_global?: boolean;
  }) {
    return apiFetch(buildUrl(ServicePath.AI, `/api/knowledge/${id}`), {
      method: 'PUT',
      headers: getHeaders(),
      body: JSON.stringify(data),
    });
  },

  /**
   * Delete knowledge vector
   */
  async deleteKnowledge(id: string) {
    return apiFetch(buildUrl(ServicePath.AI, `/api/knowledge/${id}`), {
      method: 'DELETE',
      headers: getHeaders(),
    });
  },

  /**
   * Delete document vectors from AI service
   */
  async deleteDocumentVectors(documentId: string) {
    return apiFetch(buildUrl(ServicePath.AI, `/api/upload/document/${documentId}`), {
      method: 'DELETE',
      headers: getHeaders(),
    });
  },

  /**
   * Embed all knowledge
   */
  async embedAllKnowledge(villageId?: string) {
    const url = new URL(buildUrl(ServicePath.AI, '/api/knowledge/embed-all'));
    if (villageId) url.searchParams.set('village_id', villageId);
    return apiFetch(url.toString(), {
      method: 'POST',
      headers: getHeaders(),
    });
  },

  /**
   * Get embedding status for knowledge IDs
   */
  async getKnowledgeStatuses(ids: string[]) {
    return apiFetch(buildUrl(ServicePath.AI, '/api/knowledge/status'), {
      method: 'POST',
      headers: getHeaders(),
      body: JSON.stringify({ ids }),
    });
  },

  /**
   * Upload document to AI service for processing
   */
  async uploadDocument(formData: FormData) {
    const url = buildUrl(ServicePath.AI, '/api/upload/document');
    return fetch(url, {
      method: 'POST',
      headers: {
        'x-internal-api-key': INTERNAL_API_KEY,
      },
      body: formData,
    });
  },

  async processDocument(documentId: string) {
    return apiFetch(buildUrl(ServicePath.AI, `/api/upload/document/${documentId}/process`), {
      method: 'POST',
      headers: getHeaders(),
    });
  },

  /**
   * Get AI usage stats by model
   */
  async getUsageByModel(model: string) {
    return apiFetch(buildUrl(ServicePath.AI, `/stats/models/${encodeURIComponent(model)}`), {
      headers: getHeaders(),
    });
  },

  /**
   * Get all models stats
   */
  async getModelsStats() {
    return apiFetch(buildUrl(ServicePath.AI, '/stats/models'), {
      headers: getHeaders(),
    });
  },

  /**
   * Get model stats by name
   */
  async getModelStats(model: string) {
    return apiFetch(buildUrl(ServicePath.AI, `/stats/models/${encodeURIComponent(model)}`), {
      headers: getHeaders(),
    });
  },

  /**
   * Get analytics
   */
  async getAnalytics(params?: Record<string, string>) {
    const qs = params ? '?' + new URLSearchParams(params).toString() : ''
    return apiFetch(buildUrl(ServicePath.AI, `/stats/analytics${qs}`), {
      headers: getHeaders(),
    });
  },

  /**
   * Get analytics flow
   */
  async getAnalyticsFlow(params?: Record<string, string>) {
    const qs = params ? '?' + new URLSearchParams(params).toString() : ''
    return apiFetch(buildUrl(ServicePath.AI, `/stats/analytics/flow${qs}`), {
      headers: getHeaders(),
    });
  },

  /**
   * Get analytics intents
   */
  async getAnalyticsIntents(params?: Record<string, string>) {
    const qs = params ? '?' + new URLSearchParams(params).toString() : ''
    return apiFetch(buildUrl(ServicePath.AI, `/stats/analytics/intents${qs}`), {
      headers: getHeaders(),
    });
  },

  /**
   * Get analytics tokens
   */
  async getAnalyticsTokens() {
    return apiFetch(buildUrl(ServicePath.AI, '/stats/analytics/tokens'), {
      headers: getHeaders(),
    });
  },

  /**
   * Get analytics knowledge hit/miss/gaps
   */
  async getAnalyticsKnowledge(params?: Record<string, string>) {
    const qs = params ? '?' + new URLSearchParams(params).toString() : ''
    return apiFetch(buildUrl(ServicePath.AI, `/stats/analytics/knowledge${qs}`), {
      headers: getHeaders(),
    });
  },

  /**
   * Get retrieval observability traces and aggregates
   */
  async getAnalyticsRetrieval(params?: Record<string, string>) {
    const qs = params ? '?' + new URLSearchParams(params).toString() : ''
    return apiFetch(buildUrl(ServicePath.AI, `/stats/analytics/retrieval${qs}`), {
      headers: getHeaders(),
    });
  },

  /**
   * Get memory observability traces and aggregates
   */
  async getAnalyticsMemory(params?: Record<string, string>) {
    const qs = params ? '?' + new URLSearchParams(params).toString() : ''
    return apiFetch(buildUrl(ServicePath.AI, `/stats/analytics/memory${qs}`), {
      headers: getHeaders(),
    });
  },

  /**
   * Get outer guardrail observability
   */
  async getAnalyticsGuardrails(params?: Record<string, string>) {
    const qs = params ? '?' + new URLSearchParams(params).toString() : ''
    return apiFetch(buildUrl(ServicePath.AI, `/stats/analytics/guardrails${qs}`), {
      headers: getHeaders(),
    });
  },

  /**
   * Get tool allowlist policy analytics
   */
  async getAnalyticsToolPolicy(params?: Record<string, string>) {
    const qs = params ? '?' + new URLSearchParams(params).toString() : ''
    return apiFetch(buildUrl(ServicePath.AI, `/stats/analytics/tool-policy${qs}`), {
      headers: getHeaders(),
    });
  },

  /**
   * Export observability analytics as JSON or NDJSON
   */
  async exportAnalytics(params?: Record<string, string>) {
    const qs = params ? '?' + new URLSearchParams(params).toString() : ''
    return apiFetch(buildUrl(ServicePath.AI, `/stats/analytics/export${qs}`), {
      headers: getHeaders(),
      timeout: 60000,
    });
  },

  // ==================== Token Usage (AI Gateway Models) ====================

  /**
   * Get token usage summary
   */
  async getTokenUsageSummary(params?: Record<string, string>) {
    const qs = params ? '?' + new URLSearchParams(params).toString() : '';
    return apiFetch(buildUrl(ServicePath.AI, `/stats/token-usage/summary${qs}`), {
      headers: getHeaders(),
    });
  },

  /**
   * Get token usage by period (day/week/month)
   */
  async getTokenUsageByPeriod(params?: Record<string, string>) {
    const qs = params ? '?' + new URLSearchParams(params).toString() : '';
    return apiFetch(buildUrl(ServicePath.AI, `/stats/token-usage/by-period${qs}`), {
      headers: getHeaders(),
    });
  },

  /**
   * Get token usage by period + layer type (for stacked chart)
   */
  async getTokenUsageByPeriodLayer(params?: Record<string, string>) {
    const qs = params ? '?' + new URLSearchParams(params).toString() : '';
    return apiFetch(buildUrl(ServicePath.AI, `/stats/token-usage/by-period-layer${qs}`), {
      headers: getHeaders(),
    });
  },

  /**
   * Get token usage by model
   */
  async getTokenUsageByModel(params?: Record<string, string>) {
    const qs = params ? '?' + new URLSearchParams(params).toString() : '';
    return apiFetch(buildUrl(ServicePath.AI, `/stats/token-usage/by-model${qs}`), {
      headers: getHeaders(),
    });
  },

  /**
   * Get token usage by village
   */
  async getTokenUsageByVillage(params?: Record<string, string>) {
    const qs = params ? '?' + new URLSearchParams(params).toString() : '';
    return apiFetch(buildUrl(ServicePath.AI, `/stats/token-usage/by-village${qs}`), {
      headers: getHeaders(),
    });
  },

  /**
   * Get token usage by intent family
   */
  async getTokenUsageByIntentFamily(params?: Record<string, string>) {
    const qs = params ? '?' + new URLSearchParams(params).toString() : '';
    return apiFetch(buildUrl(ServicePath.AI, `/stats/token-usage/by-intent-family${qs}`), {
      headers: getHeaders(),
    });
  },

  /**
   * Get token usage by tenant flow
   */
  async getTokenUsageByTenantFlow(params?: Record<string, string>) {
    const qs = params ? '?' + new URLSearchParams(params).toString() : '';
    return apiFetch(buildUrl(ServicePath.AI, `/stats/token-usage/by-tenant-flow${qs}`), {
      headers: getHeaders(),
    });
  },

  /**
   * Get micro vs full NLU layer breakdown
   */
  async getTokenUsageLayerBreakdown(params?: Record<string, string>) {
    const qs = params ? '?' + new URLSearchParams(params).toString() : '';
    return apiFetch(buildUrl(ServicePath.AI, `/stats/token-usage/layer-breakdown${qs}`), {
      headers: getHeaders(),
    });
  },

  /**
   * Get average tokens per chat
   */
  async getTokenUsageAvgPerChat(params?: Record<string, string>) {
    const qs = params ? '?' + new URLSearchParams(params).toString() : '';
    return apiFetch(buildUrl(ServicePath.AI, `/stats/token-usage/avg-per-chat${qs}`), {
      headers: getHeaders(),
    });
  },

  /**
   * Get AI response count per village (main_chat only)
   */
  async getTokenUsageResponsesByVillage(params?: Record<string, string>) {
    const qs = params ? '?' + new URLSearchParams(params).toString() : '';
    return apiFetch(buildUrl(ServicePath.AI, `/stats/token-usage/responses-by-village${qs}`), {
      headers: getHeaders(),
    });
  },

  /**
   * Get detailed usage per village + model
   */
  async getTokenUsageVillageModelDetail(params?: Record<string, string>) {
    const qs = params ? '?' + new URLSearchParams(params).toString() : '';
    return apiFetch(buildUrl(ServicePath.AI, `/stats/token-usage/village-model-detail${qs}`), {
      headers: getHeaders(),
    });
  },

  /**
   * Get token usage by provider
   */
  async getTokenUsageByProvider(params?: Record<string, string>) {
    const qs = params ? '?' + new URLSearchParams(params).toString() : '';
    return apiFetch(buildUrl(ServicePath.AI, `/stats/token-usage/by-provider${qs}`), {
      headers: getHeaders(),
    });
  },

  /**
   * Get token usage breakdown by recorded gateway lane / source
   */
  async getTokenUsageBySource(params?: Record<string, string>) {
    const qs = params ? '?' + new URLSearchParams(params).toString() : '';
    return apiFetch(buildUrl(ServicePath.AI, `/stats/token-usage/by-source${qs}`), {
      headers: getHeaders(),
    });
  },

  async getVillageAIUsageUsers(villageId: string, params?: Record<string, string>) {
    const qs = params ? '?' + new URLSearchParams(params).toString() : '';
    return apiFetch(buildUrl(ServicePath.AI, `/admin/ai-usage/village/${encodeURIComponent(villageId)}/users${qs}`), {
      headers: getHeaders(),
    });
  },

  async getVillageAIUsageMessages(villageId: string, params?: Record<string, string>) {
    const qs = params ? '?' + new URLSearchParams(params).toString() : '';
    return apiFetch(buildUrl(ServicePath.AI, `/admin/ai-usage/village/${encodeURIComponent(villageId)}/messages${qs}`), {
      headers: getHeaders(),
    });
  },

  async getVillageAIUsageMessageDetail(villageId: string, billingId: string) {
    return apiFetch(buildUrl(ServicePath.AI, `/admin/ai-usage/village/${encodeURIComponent(villageId)}/messages/${encodeURIComponent(billingId)}`), {
      headers: getHeaders(),
    });
  },

  async getAIGenerationLogs(params?: Record<string, string>) {
    const qs = params ? '?' + new URLSearchParams(params).toString() : '';
    return apiFetch(buildUrl(ServicePath.AI, `/admin/ai-usage/generations${qs}`), {
      headers: getHeaders(),
    });
  },

  async getAIGenerationLogDetail(id: string) {
    return apiFetch(buildUrl(ServicePath.AI, `/admin/ai-usage/generations/${encodeURIComponent(id)}`), {
      headers: getHeaders(),
    });
  },

  async getAIWalletSummary(villageId: string) {
    return apiFetch(buildUrl(ServicePath.AI, `/admin/ai-wallet/${encodeURIComponent(villageId)}`), {
      headers: getHeaders(),
    });
  },

  async getAIWalletLedger(villageId: string, params?: Record<string, string>) {
    const qs = params ? '?' + new URLSearchParams(params).toString() : '';
    return apiFetch(buildUrl(ServicePath.AI, `/admin/ai-wallet/${encodeURIComponent(villageId)}/ledger${qs}`), {
      headers: getHeaders(),
    });
  },

  async getAIBillingReconciliation(params?: Record<string, string>) {
    const qs = params ? '?' + new URLSearchParams(params).toString() : '';
    return apiFetch(buildUrl(ServicePath.AI, `/admin/ai-billing/reconciliation${qs}`), {
      headers: getHeaders(),
    });
  },

  async getAIBillingReconciliationDetail(billingId: string) {
    return apiFetch(buildUrl(ServicePath.AI, `/admin/ai-billing/reconciliation/${encodeURIComponent(billingId)}`), {
      headers: getHeaders(),
    });
  },

  async getAIBillingTrace(traceId: string) {
    return apiFetch(buildUrl(ServicePath.AI, `/admin/ai-billing/trace/${encodeURIComponent(traceId)}`), {
      headers: getHeaders(),
    });
  },

  async retryPendingAIBilling(villageId: string, data: Record<string, any> = {}) {
    return apiFetch(buildUrl(ServicePath.AI, `/admin/ai-wallet/${encodeURIComponent(villageId)}/retry-pending`), {
      method: 'POST',
      headers: getHeaders(),
      body: JSON.stringify(data),
    });
  },

  async listAIWallets() {
    return apiFetch(buildUrl(ServicePath.AI, '/admin/ai-wallets'), {
      headers: getHeaders(),
    });
  },

  async topupAIWallet(villageId: string, data: Record<string, any>) {
    return apiFetch(buildUrl(ServicePath.AI, `/admin/ai-wallet/${encodeURIComponent(villageId)}/topup`), {
      method: 'POST',
      headers: getHeaders(),
      body: JSON.stringify(data),
    });
  },

  async adjustAIWallet(villageId: string, data: Record<string, any>) {
    return apiFetch(buildUrl(ServicePath.AI, `/admin/ai-wallet/${encodeURIComponent(villageId)}/adjust`), {
      method: 'POST',
      headers: getHeaders(),
      body: JSON.stringify(data),
    });
  },

  async redeemAIWalletVoucher(villageId: string, data: Record<string, any>) {
    return apiFetch(buildUrl(ServicePath.AI, `/admin/ai-wallet/${encodeURIComponent(villageId)}/redeem-voucher`), {
      method: 'POST',
      headers: getHeaders(),
      body: JSON.stringify(data),
    });
  },

  // ── Held messages (wallet exhausted) — live on Channel Service ──
  async listHeldConversations(villageId: string) {
    return apiFetch(buildUrl(ServicePath.CHANNEL, '/internal/held-messages/conversations'), {
      headers: getHeaders({ 'x-village-id': villageId }),
    });
  },

  async flushHeldMessages(villageId: string, channelIdentifier: string) {
    return apiFetch(
      buildUrl(ServicePath.CHANNEL, `/internal/held-messages/flush?channel_identifier=${encodeURIComponent(channelIdentifier)}`),
      {
        method: 'POST',
        headers: getHeaders({ 'x-village-id': villageId }),
        body: JSON.stringify({}),
      }
    );
  },

  async flushAllHeldMessages(villageId: string) {
    return apiFetch(buildUrl(ServicePath.CHANNEL, '/internal/held-messages/flush-all'), {
      method: 'POST',
      headers: getHeaders({ 'x-village-id': villageId }),
      body: JSON.stringify({}),
    });
  },

  async listAIVouchers() {
    return apiFetch(buildUrl(ServicePath.AI, '/admin/ai-vouchers'), {
      headers: getHeaders(),
    });
  },

  async createAIVoucher(data: Record<string, any>) {
    return apiFetch(buildUrl(ServicePath.AI, '/admin/ai-vouchers'), {
      method: 'POST',
      headers: getHeaders(),
      body: JSON.stringify(data),
    });
  },

  async listAIProviders() {
    return apiFetch(buildUrl(ServicePath.AI, '/admin/ai-providers'), {
      headers: getHeaders(),
    });
  },

  async createAIProvider(data: Record<string, any>) {
    return apiFetch(buildUrl(ServicePath.AI, '/admin/ai-providers'), {
      method: 'POST',
      headers: getHeaders(),
      body: JSON.stringify(data),
    });
  },

  async updateAIProvider(id: string, data: Record<string, any>) {
    return apiFetch(buildUrl(ServicePath.AI, `/admin/ai-providers/${encodeURIComponent(id)}`), {
      method: 'PUT',
      headers: getHeaders(),
      body: JSON.stringify(data),
    });
  },

  async deleteAIProvider(id: string) {
    return apiFetch(buildUrl(ServicePath.AI, `/admin/ai-providers/${encodeURIComponent(id)}`), {
      method: 'DELETE',
      headers: getHeaders(),
    });
  },

  async listAIModels() {
    return apiFetch(buildUrl(ServicePath.AI, '/admin/ai-models'), {
      headers: getHeaders(),
    });
  },

  async createAIModel(data: Record<string, any>) {
    return apiFetch(buildUrl(ServicePath.AI, '/admin/ai-models'), {
      method: 'POST',
      headers: getHeaders(),
      body: JSON.stringify(data),
    });
  },

  async updateAIModel(id: string, data: Record<string, any>) {
    return apiFetch(buildUrl(ServicePath.AI, `/admin/ai-models/${encodeURIComponent(id)}`), {
      method: 'PUT',
      headers: getHeaders(),
      body: JSON.stringify(data),
    });
  },

  async deleteAIModel(id: string) {
    return apiFetch(buildUrl(ServicePath.AI, `/admin/ai-models/${encodeURIComponent(id)}`), {
      method: 'DELETE',
      headers: getHeaders(),
    });
  },

  async testAIModel(payload: string | { draft: Record<string, any> }) {
    return apiFetch(buildUrl(ServicePath.AI, '/api/testing/model'), {
      method: 'POST',
      headers: getHeaders(),
      body: JSON.stringify(typeof payload === 'string' ? { model_id: payload } : payload),
      timeout: 20000,
    });
  },

  async listAILaneAssignments() {
    return apiFetch(buildUrl(ServicePath.AI, '/admin/ai-lane-assignments'), {
      headers: getHeaders(),
    });
  },

  async upsertAILaneAssignment(data: Record<string, any>) {
    return apiFetch(buildUrl(ServicePath.AI, '/admin/ai-lane-assignments'), {
      method: 'POST',
      headers: getHeaders(),
      body: JSON.stringify(data),
    });
  },

  /**
   * Get golden set summary
   */
  async getGoldenSetSummary() {
    return apiFetch(buildUrl(ServicePath.AI, '/stats/golden-set'), {
      headers: getHeaders(),
    });
  },

  /**
   * Run golden set evaluation
   */
  async runGoldenSetEvaluation(payload: { items: Array<Record<string, any>>; village_id?: string }) {
    return apiFetch(buildUrl(ServicePath.AI, '/stats/golden-set/run'), {
      method: 'POST',
      headers: getHeaders(),
      body: JSON.stringify(payload),
    });
  },

  /**
   * Get rate limit config
   */
  async getRateLimit(villageId?: string | null) {
    const qs = villageId ? `?village_id=${encodeURIComponent(villageId)}` : '';
    return apiFetch(buildUrl(ServicePath.AI, `/rate-limit${qs}`), {
      headers: getHeaders(),
    });
  },

  /**
   * Get blacklist
   */
  async getBlacklist(villageId?: string | null) {
    const qs = villageId ? `?village_id=${encodeURIComponent(villageId)}` : '';
    return apiFetch(buildUrl(ServicePath.AI, `/rate-limit/blacklist${qs}`), {
      headers: getHeaders(),
    });
  },

  /**
   * Add to blacklist
   */
  async addToBlacklist(data: { wa_user_id: string; reason: string; village_id?: string | null }) {
    return apiFetch(buildUrl(ServicePath.AI, '/rate-limit/blacklist'), {
      method: 'POST',
      headers: getHeaders(),
      body: JSON.stringify(data),
    });
  },

  /**
   * Remove from blacklist
   */
  async removeFromBlacklist(waUserId: string, villageId?: string | null) {
    const qs = villageId ? `?village_id=${encodeURIComponent(villageId)}` : '';
    return apiFetch(buildUrl(ServicePath.AI, `/rate-limit/blacklist/${waUserId}${qs}`), {
      method: 'DELETE',
      headers: getHeaders(),
    });
  },

  /**
   * Get spam guard stats from AI service
   */
  async getSpamGuardStats(villageId?: string | null) {
    const qs = villageId ? `?village_id=${encodeURIComponent(villageId)}` : '';
    return apiFetch(buildUrl(ServicePath.AI, `/spam-guard/stats${qs}`), {
      headers: getHeaders(),
    });
  },

  /**
   * Get spam guard bans from channel service
   */
  async getSpamGuardBans(villageId?: string | null) {
    const qs = villageId ? `?village_id=${encodeURIComponent(villageId)}` : '';
    return apiFetch(buildUrl(ServicePath.CHANNEL, `/internal/spam-guard/bans${qs}`), {
      headers: getHeaders(),
    });
  },

  /**
   * Remove a spam ban
   */
  async removeSpamBan(waUserId: string, villageId?: string) {
    const query = villageId ? `?village_id=${encodeURIComponent(villageId)}` : '';
    return apiFetch(buildUrl(ServicePath.CHANNEL, `/internal/spam-guard/bans/${waUserId}${query}`), {
      method: 'DELETE',
      headers: getHeaders(),
    });
  },
};

// ==================== LIVECHAT (Channel Service) ====================
function withVillage(path: string, villageId?: string) {
  if (!villageId) return path;
  const joiner = path.includes('?') ? '&' : '?';
  return `${path}${joiner}village_id=${encodeURIComponent(villageId)}`;
}

export const livechat = {
  /**
   * Get conversations
   */
  async getConversations(status: string = 'all', villageId?: string, search?: string, limit?: string, offset?: string) {
    const params = new URLSearchParams({ status });
    if (search) params.set('search', search);
    if (limit) params.set('limit', limit);
    if (offset) params.set('offset', offset);
    const path = withVillage(`/internal/conversations?${params.toString()}`, villageId);
    return apiFetch(buildUrl(ServicePath.CHANNEL, path), {
      headers: getHeaders(),
    });
  },

  /**
   * Get AI processing status for a user
   */
  async getProcessingStatus(userId: string) {
    return apiFetch(buildUrl(ServicePath.AI, `/api/status/${encodeURIComponent(userId)}`), {
      headers: getHeaders(),
    });
  },

  /**
   * Get all active AI processing statuses
   */
  async getActiveProcessingStatuses() {
    return apiFetch(buildUrl(ServicePath.AI, '/api/status/active'), {
      headers: getHeaders(),
    });
  },

  /**
   * Get AI processing summary
   */
  async getProcessingSummary() {
    return apiFetch(buildUrl(ServicePath.AI, '/api/status/summary'), {
      headers: getHeaders(),
    });
  },

  /**
   * Get conversation by wa_user_id
   */
  async getConversation(waUserId: string, villageId?: string) {
    const path = withVillage(`/internal/conversations/${encodeURIComponent(waUserId)}`, villageId);
    return apiFetch(buildUrl(ServicePath.CHANNEL, path), {
      headers: getHeaders(),
    });
  },

  /**
   * Delete conversation
   */
  async deleteConversation(waUserId: string, villageId?: string) {
    const path = withVillage(`/internal/conversations/${encodeURIComponent(waUserId)}`, villageId);
    return apiFetch(buildUrl(ServicePath.CHANNEL, path), {
      method: 'DELETE',
      headers: getHeaders(),
    });
  },

  /**
   * Send message
   */
  async sendMessage(waUserId: string, data: {
    message?: string;
    admin_id?: string;
    admin_name?: string | null;
    reply_to_message_id?: string;
    media?: {
      type: 'image' | 'audio' | 'document' | 'video';
      url: string;
      internal_url?: string;
      mime_type?: string;
      file_name?: string;
      size?: number;
      storage_key?: string;
    };
    location?: {
      latitude: number;
      longitude: number;
      name?: string;
      address?: string;
    };
    contact?: {
      name: string;
      phone: string;
      organization?: string;
      title?: string;
      vcard?: string;
    };
    interactive?: {
      type: 'buttons' | 'list';
      body: string;
      title?: string;
      footer?: string;
      image?: string;
      buttonText?: string;
      button_text?: string;
      buttons?: Array<Record<string, unknown>>;
      sections?: Array<Record<string, unknown>>;
    };
  }, villageId?: string) {
    const path = withVillage(`/internal/conversations/${encodeURIComponent(waUserId)}/send`, villageId);
    return apiFetch(buildUrl(ServicePath.CHANNEL, path), {
      method: 'POST',
      headers: getHeaders(),
      body: JSON.stringify(data),
    });
  },

  /**
   * Retry message
   */
  async retryMessage(waUserId: string, data: { messageId: string }, villageId?: string) {
    const path = withVillage(`/internal/conversations/${encodeURIComponent(waUserId)}/retry`, villageId);
    return apiFetch(buildUrl(ServicePath.CHANNEL, path), {
      method: 'POST',
      headers: getHeaders(),
      body: JSON.stringify(data),
    });
  },

  /**
   * Mark as read
   */
  async markAsRead(waUserId: string, villageId?: string) {
    const path = withVillage(`/internal/conversations/${encodeURIComponent(waUserId)}/read`, villageId);
    return apiFetch(buildUrl(ServicePath.CHANNEL, path), {
      method: 'POST',
      headers: getHeaders(),
    });
  },

  async setTyping(waUserId: string, data: { state: 'composing' | 'paused'; actor?: 'admin' | 'ai' }, villageId?: string) {
    const path = withVillage(`/internal/conversations/${encodeURIComponent(waUserId)}/typing`, villageId);
    return apiFetch(buildUrl(ServicePath.CHANNEL, path), {
      method: 'POST',
      headers: getHeaders(),
      body: JSON.stringify(data),
    });
  },

  /**
   * Get all takeovers
   */
  async getTakeovers(villageId?: string) {
    const path = withVillage('/internal/takeover', villageId);
    return apiFetch(buildUrl(ServicePath.CHANNEL, path), {
      headers: getHeaders(),
    });
  },

  /**
   * Get takeover status
   */
  async getTakeoverStatus(waUserId: string, villageId?: string) {
    const path = withVillage(`/internal/takeover/${encodeURIComponent(waUserId)}/status`, villageId);
    return apiFetch(buildUrl(ServicePath.CHANNEL, path), {
      headers: getHeaders(),
    });
  },

  /**
   * Start takeover
   */
  async startTakeover(waUserId: string, data: { admin_id: string; admin_name: string; reason?: string }, villageId?: string) {
    const path = withVillage(`/internal/takeover/${encodeURIComponent(waUserId)}`, villageId);
    return apiFetch(buildUrl(ServicePath.CHANNEL, path), {
      method: 'POST',
      headers: getHeaders(),
      body: JSON.stringify(data),
    });
  },

  /**
   * End takeover
   */
  async endTakeover(waUserId: string, villageId?: string) {
    const path = withVillage(`/internal/takeover/${encodeURIComponent(waUserId)}`, villageId);
    return apiFetch(buildUrl(ServicePath.CHANNEL, path), {
      method: 'DELETE',
      headers: getHeaders(),
    });
  },
};

// Named export for backward compatibility
// These are shorthand methods that map to the service methods
export const apiClient = {
  case: caseService,
  ai,
  livechat,
  buildUrl,
  getHeaders,
  apiFetch,
  ServicePath,
  API_BASE_URL,
  INTERNAL_API_KEY,
  
  // Shorthand methods for backward compatibility
  async getComplaints() {
    const response = await caseService.getLaporan();
    return response.json();
  },
  
  async getComplaintById(id: string) {
    const response = await caseService.getLaporanById(id);
    return response.json();
  },
  
  async updateComplaintStatus(id: string, data: { status: string; admin_notes?: string }) {
    const response = await caseService.updateLaporanStatus(id, { status: data.status, admin_notes: data.admin_notes });
    return response.json();
  },
  
  async getStatistics() {
    const response = await caseService.getOverview();
    return response.json();
  },
  
  async getTrends(period: string = 'weekly') {
    const response = await caseService.getTrends(period);
    return response.json();
  },
  
  // Auth token management
  setAuthToken(token: string) {
    authToken = token;
  },
  
  clearAuthToken() {
    authToken = null;
  },
  
  getAuthToken() {
    return authToken;
  },
};

// Export default
export default apiClient;
// Build trigger: 2025-12-13 23.17.56
