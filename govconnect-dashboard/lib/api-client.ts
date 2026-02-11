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

// Lazy getter for INTERNAL_API_KEY - checked at runtime, not build time
let _internalApiKey: string | null = null;

export function getInternalApiKey(): string {
  if (_internalApiKey !== null) return _internalApiKey;
  
  const keyValue = process.env['INTERNAL_API_KEY'];
  if (!keyValue && process.env.NODE_ENV === 'production') {
    console.error('CRITICAL: INTERNAL_API_KEY environment variable is required in production');
  }
  _internalApiKey = keyValue || 'dev-only-key-do-not-use-in-production';
  return _internalApiKey;
}

// For backward compatibility - uses lazy getter
export const INTERNAL_API_KEY = process.env['INTERNAL_API_KEY'] || 'dev-only-key-do-not-use-in-production';

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

/**
 * Build full URL untuk service
 * Prioritas: Direct service URL > API_BASE_URL with path prefix
 */
export function buildUrl(service: ServicePathType, path: string): string {
  // Pastikan path dimulai dengan /
  const normalizedPath = path.startsWith('/') ? path : `/${path}`;
  
  // Use direct service URL if available
  const directUrl = serviceUrlMap[service];
  if (directUrl) {
    return `${directUrl}${normalizedPath}`;
  }
  
  // Fallback to API_BASE_URL with path prefix
  return `${API_BASE_URL}${service}${normalizedPath}`;
}

/**
 * Get headers dengan internal API key
 */
export function getHeaders(additionalHeaders?: Record<string, string>): Record<string, string> {
  return {
    'Content-Type': 'application/json',
    'x-internal-api-key': INTERNAL_API_KEY,
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
  async getLaporan(params?: { status?: string; limit?: string; offset?: string; village_id?: string }) {
    const url = new URL(buildUrl(ServicePath.CASE, '/laporan'));
    if (params?.status) url.searchParams.set('status', params.status);
    if (params?.limit) url.searchParams.set('limit', params.limit);
    if (params?.offset) url.searchParams.set('offset', params.offset);
    if (params?.village_id) url.searchParams.set('village_id', params.village_id);
    
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
  async updateLaporanStatus(id: string, data: { status: string; notes?: string }, village_id?: string) {
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
  async softDeleteLaporan(id: string, village_id?: string) {
    const url = new URL(buildUrl(ServicePath.CASE, `/laporan/${id}/soft-delete`));
    if (village_id) url.searchParams.set('village_id', village_id);
    return apiFetch(url.toString(), {
      method: 'PATCH',
      headers: getHeaders(),
    });
  },

  /**
   * Restore soft-deleted laporan
   */
  async restoreLaporan(id: string, village_id?: string) {
    const url = new URL(buildUrl(ServicePath.CASE, `/laporan/${id}/restore`));
    if (village_id) url.searchParams.set('village_id', village_id);
    return apiFetch(url.toString(), {
      method: 'PATCH',
      headers: getHeaders(),
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
  async softDeleteServiceRequest(id: string, village_id?: string) {
    const url = new URL(buildUrl(ServicePath.CASE, `/service-requests/${id}/soft-delete`));
    if (village_id) url.searchParams.set('village_id', village_id);
    return apiFetch(url.toString(), {
      method: 'PATCH',
      headers: getHeaders(),
    });
  },

  /**
   * Restore soft-deleted service request
   */
  async restoreServiceRequest(id: string, village_id?: string) {
    const url = new URL(buildUrl(ServicePath.CASE, `/service-requests/${id}/restore`));
    if (village_id) url.searchParams.set('village_id', village_id);
    return apiFetch(url.toString(), {
      method: 'PATCH',
      headers: getHeaders(),
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
  async getServiceRequestById(id: string) {
    return apiFetch(buildUrl(ServicePath.CASE, `/service-requests/${id}`), {
      headers: getHeaders(),
    });
  },

  /**
   * Update service request status
   */
  async updateServiceRequestStatus(id: string, data: { status: string; admin_notes?: string }) {
    return apiFetch(buildUrl(ServicePath.CASE, `/service-requests/${id}/status`), {
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
  async getTrends(period: string = 'week', village_id?: string) {
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
    title: string;
    content: string;
    category: string;
    keywords: string[];
    qualityScore?: number;
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
    title: string;
    content: string;
    category: string;
    keywords: string[];
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
  async embedAllKnowledge() {
    return apiFetch(buildUrl(ServicePath.AI, '/api/knowledge/embed-all'), {
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

  /**
   * Get AI usage stats by model
   */
  async getUsageByModel(model: string) {
    return apiFetch(buildUrl(ServicePath.AI, `/stats/usage/${model}`), {
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
  async getAnalytics() {
    return apiFetch(buildUrl(ServicePath.AI, '/stats/analytics'), {
      headers: getHeaders(),
    });
  },

  /**
   * Get analytics flow
   */
  async getAnalyticsFlow() {
    return apiFetch(buildUrl(ServicePath.AI, '/stats/analytics/flow'), {
      headers: getHeaders(),
    });
  },

  /**
   * Get analytics intents
   */
  async getAnalyticsIntents() {
    return apiFetch(buildUrl(ServicePath.AI, '/stats/analytics/intents'), {
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
  async getAnalyticsKnowledge() {
    return apiFetch(buildUrl(ServicePath.AI, '/stats/analytics/knowledge'), {
      headers: getHeaders(),
    });
  },

  // ==================== Token Usage (Real Gemini) ====================

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
   * Get token usage breakdown by key source (BYOK vs ENV)
   */
  async getTokenUsageBySource(params?: Record<string, string>) {
    const qs = params ? '?' + new URLSearchParams(params).toString() : '';
    return apiFetch(buildUrl(ServicePath.AI, `/stats/token-usage/by-source${qs}`), {
      headers: getHeaders(),
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
  async getRateLimit() {
    return apiFetch(buildUrl(ServicePath.AI, '/rate-limit'), {
      headers: getHeaders(),
    });
  },

  /**
   * Get blacklist
   */
  async getBlacklist() {
    return apiFetch(buildUrl(ServicePath.AI, '/rate-limit/blacklist'), {
      headers: getHeaders(),
    });
  },

  /**
   * Add to blacklist
   */
  async addToBlacklist(data: { wa_user_id: string; reason: string }) {
    return apiFetch(buildUrl(ServicePath.AI, '/rate-limit/blacklist'), {
      method: 'POST',
      headers: getHeaders(),
      body: JSON.stringify(data),
    });
  },

  /**
   * Remove from blacklist
   */
  async removeFromBlacklist(waUserId: string) {
    return apiFetch(buildUrl(ServicePath.AI, `/rate-limit/blacklist/${waUserId}`), {
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
  async getConversations(status: string = 'all', villageId?: string) {
    const path = withVillage(`/internal/conversations?status=${status}`, villageId);
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
  async sendMessage(waUserId: string, data: { message: string }, villageId?: string) {
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

  /**
   * Get all takeovers
   */
  async getTakeovers() {
    return apiFetch(buildUrl(ServicePath.CHANNEL, '/internal/takeover'), {
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
  async startTakeover(waUserId: string, data: { admin_id: string; admin_name: string }, villageId?: string) {
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
    const response = await caseService.updateLaporanStatus(id, { status: data.status, notes: data.admin_notes });
    return response.json();
  },
  
  async getStatistics() {
    const response = await caseService.getOverview();
    return response.json();
  },
  
  async getTrends(period: string = 'week') {
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
