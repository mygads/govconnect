/**
 * API Client - Single Endpoint untuk semua service
 * 
 * Dashboard berkomunikasi ke semua backend services melalui 1 endpoint saja (Traefik)
 * 
 * ROUTING:
 * ┌─────────────────────────────────────────────────────────────────────────────────┐
 * │  API_BASE_URL (Traefik)                                                        │
 * │  ─────────────────────────────────────────────────────────────────────────────  │
 * │  /channel/*      → Channel Service (WhatsApp, Messages)                        │
 * │  /ai/*           → AI Service (Knowledge, Documents, Embeddings)               │
 * │  /case/*         → Case Service (Laporan, Tiket, Statistics)                   │
 * │  /notification/* → Notification Service                                        │
 * └─────────────────────────────────────────────────────────────────────────────────┘
 * 
 * ENVIRONMENT:
 * - Local Dev: http://localhost:80 (Traefik) atau langsung ke service
 * - Docker: http://traefik (internal Docker network)
 * - Production: https://api.govconnect.my.id
 */

// Single endpoint - Traefik gateway
export const API_BASE_URL = process.env.API_BASE_URL || 'http://traefik';
export const INTERNAL_API_KEY = process.env.INTERNAL_API_KEY || 'govconnect-internal-2025-secret';

// Auth token storage
let authToken: string | null = null;

// Service path prefixes
export const ServicePath = {
  CHANNEL: '/channel',
  AI: '/ai',
  CASE: '/case',
  NOTIFICATION: '/notification',
} as const;

export type ServicePathType = typeof ServicePath[keyof typeof ServicePath];

/**
 * Build full URL untuk service
 */
export function buildUrl(service: ServicePathType, path: string): string {
  // Pastikan path dimulai dengan /
  const normalizedPath = path.startsWith('/') ? path : `/${path}`;
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

// ==================== CHANNEL SERVICE ====================
export const channel = {
  /**
   * WhatsApp status
   */
  async getStatus() {
    return apiFetch(buildUrl(ServicePath.CHANNEL, '/internal/whatsapp/status'), {
      headers: getHeaders(),
    });
  },

  /**
   * WhatsApp QR code
   */
  async getQR() {
    return apiFetch(buildUrl(ServicePath.CHANNEL, '/internal/whatsapp/qr'), {
      headers: getHeaders(),
    });
  },

  /**
   * Connect WhatsApp
   */
  async connect() {
    return apiFetch(buildUrl(ServicePath.CHANNEL, '/internal/whatsapp/connect'), {
      method: 'POST',
      headers: getHeaders(),
    });
  },

  /**
   * Disconnect WhatsApp
   */
  async disconnect() {
    return apiFetch(buildUrl(ServicePath.CHANNEL, '/internal/whatsapp/disconnect'), {
      method: 'POST',
      headers: getHeaders(),
    });
  },

  /**
   * Logout WhatsApp
   */
  async logout() {
    return apiFetch(buildUrl(ServicePath.CHANNEL, '/internal/whatsapp/logout'), {
      method: 'POST',
      headers: getHeaders(),
    });
  },

  /**
   * Pair phone
   */
  async pairPhone(phoneNumber: string) {
    return apiFetch(buildUrl(ServicePath.CHANNEL, '/internal/whatsapp/pairphone'), {
      method: 'POST',
      headers: getHeaders(),
      body: JSON.stringify({ phoneNumber }),
    });
  },

  /**
   * Get settings
   */
  async getSettings() {
    return apiFetch(buildUrl(ServicePath.CHANNEL, '/internal/whatsapp/settings'), {
      headers: getHeaders(),
    });
  },

  /**
   * Update settings
   */
  async updateSettings(settings: any) {
    return apiFetch(buildUrl(ServicePath.CHANNEL, '/internal/whatsapp/settings'), {
      method: 'PATCH',
      headers: getHeaders(),
      body: JSON.stringify(settings),
    });
  },
};

// ==================== CASE SERVICE ====================
export const caseService = {
  /**
   * Get laporan list
   */
  async getLaporan(params?: { status?: string; limit?: string; offset?: string }) {
    const url = new URL(buildUrl(ServicePath.CASE, '/laporan'));
    if (params?.status) url.searchParams.set('status', params.status);
    if (params?.limit) url.searchParams.set('limit', params.limit);
    if (params?.offset) url.searchParams.set('offset', params.offset);
    
    return apiFetch(url.toString(), {
      headers: getHeaders(),
    });
  },

  /**
   * Get laporan by ID
   */
  async getLaporanById(id: string) {
    return apiFetch(buildUrl(ServicePath.CASE, `/laporan/${id}`), {
      headers: getHeaders(),
    });
  },

  /**
   * Update laporan status
   */
  async updateLaporanStatus(id: string, data: { status: string; notes?: string }) {
    return apiFetch(buildUrl(ServicePath.CASE, `/laporan/${id}/status`), {
      method: 'PATCH',
      headers: getHeaders(),
      body: JSON.stringify(data),
    });
  },

  /**
   * Get tiket list
   */
  async getTiket(params?: { jenis?: string; status?: string; limit?: string; offset?: string }) {
    const url = new URL(buildUrl(ServicePath.CASE, '/tiket'));
    if (params?.jenis) url.searchParams.set('jenis', params.jenis);
    if (params?.status) url.searchParams.set('status', params.status);
    if (params?.limit) url.searchParams.set('limit', params.limit);
    if (params?.offset) url.searchParams.set('offset', params.offset);
    
    return apiFetch(url.toString(), {
      headers: getHeaders(),
    });
  },

  /**
   * Get tiket by ID
   */
  async getTiketById(id: string) {
    return apiFetch(buildUrl(ServicePath.CASE, `/tiket/${id}`), {
      headers: getHeaders(),
    });
  },

  /**
   * Update tiket status
   */
  async updateTiketStatus(id: string, data: { status: string; notes?: string }) {
    return apiFetch(buildUrl(ServicePath.CASE, `/tiket/${id}/status`), {
      method: 'PATCH',
      headers: getHeaders(),
      body: JSON.stringify(data),
    });
  },

  /**
   * Get statistics overview
   */
  async getOverview() {
    return apiFetch(buildUrl(ServicePath.CASE, '/statistics/overview'), {
      headers: getHeaders(),
      timeout: 25000,
    });
  },

  /**
   * Get statistics trends
   */
  async getTrends(period: string = 'week') {
    return apiFetch(buildUrl(ServicePath.CASE, `/statistics/trends?period=${period}`), {
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
   * Add document vectors
   */
  async addDocument(data: {
    documentId: string;
    documentTitle?: string;
    category?: string;
    chunks: Array<{ chunkIndex: number; content: string; pageNumber?: number }>;
  }) {
    return apiFetch(buildUrl(ServicePath.AI, '/api/documents'), {
      method: 'POST',
      headers: getHeaders(),
      body: JSON.stringify(data),
    });
  },

  /**
   * Update document vectors
   */
  async updateDocument(documentId: string, data: {
    documentTitle?: string;
    category?: string;
    chunks: Array<{ chunkIndex: number; content: string; pageNumber?: number }>;
  }) {
    return apiFetch(buildUrl(ServicePath.AI, `/api/documents/${documentId}`), {
      method: 'PUT',
      headers: getHeaders(),
      body: JSON.stringify(data),
    });
  },

  /**
   * Delete document vectors
   */
  async deleteDocument(documentId: string) {
    return apiFetch(buildUrl(ServicePath.AI, `/api/documents/${documentId}`), {
      method: 'DELETE',
      headers: getHeaders(),
    });
  },

  /**
   * Embed all knowledge
   */
  async embedAllKnowledge() {
    return apiFetch(buildUrl(ServicePath.AI, '/api/internal/embed-all-knowledge'), {
      method: 'POST',
      headers: getHeaders(),
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

  /**
   * Process document (chunking and embedding)
   */
  async processDocument(data: {
    documentId: string;
    content: string;
    mimeType: string;
    title: string;
    category: string;
  }) {
    return apiFetch(buildUrl(ServicePath.AI, '/api/internal/process-document'), {
      method: 'POST',
      headers: getHeaders(),
      body: JSON.stringify(data),
    });
  },
};

// ==================== LIVECHAT (Channel Service) ====================
export const livechat = {
  /**
   * Get conversations
   */
  async getConversations(status: string = 'all') {
    return apiFetch(buildUrl(ServicePath.CHANNEL, `/internal/conversations?status=${status}`), {
      headers: getHeaders(),
    });
  },

  /**
   * Get conversation by wa_user_id
   */
  async getConversation(waUserId: string) {
    return apiFetch(buildUrl(ServicePath.CHANNEL, `/internal/conversations/${encodeURIComponent(waUserId)}`), {
      headers: getHeaders(),
    });
  },

  /**
   * Delete conversation
   */
  async deleteConversation(waUserId: string) {
    return apiFetch(buildUrl(ServicePath.CHANNEL, `/internal/conversations/${encodeURIComponent(waUserId)}`), {
      method: 'DELETE',
      headers: getHeaders(),
    });
  },

  /**
   * Send message
   */
  async sendMessage(waUserId: string, data: { message: string }) {
    return apiFetch(buildUrl(ServicePath.CHANNEL, `/internal/conversations/${encodeURIComponent(waUserId)}/send`), {
      method: 'POST',
      headers: getHeaders(),
      body: JSON.stringify(data),
    });
  },

  /**
   * Retry message
   */
  async retryMessage(waUserId: string, data: { messageId: string }) {
    return apiFetch(buildUrl(ServicePath.CHANNEL, `/internal/conversations/${encodeURIComponent(waUserId)}/retry`), {
      method: 'POST',
      headers: getHeaders(),
      body: JSON.stringify(data),
    });
  },

  /**
   * Mark as read
   */
  async markAsRead(waUserId: string) {
    return apiFetch(buildUrl(ServicePath.CHANNEL, `/internal/conversations/${encodeURIComponent(waUserId)}/read`), {
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
  async getTakeoverStatus(waUserId: string) {
    return apiFetch(buildUrl(ServicePath.CHANNEL, `/internal/takeover/${encodeURIComponent(waUserId)}/status`), {
      headers: getHeaders(),
    });
  },

  /**
   * Start takeover
   */
  async startTakeover(waUserId: string, data: { admin_id: string; admin_name: string }) {
    return apiFetch(buildUrl(ServicePath.CHANNEL, `/internal/takeover/${encodeURIComponent(waUserId)}`), {
      method: 'POST',
      headers: getHeaders(),
      body: JSON.stringify(data),
    });
  },

  /**
   * End takeover
   */
  async endTakeover(waUserId: string) {
    return apiFetch(buildUrl(ServicePath.CHANNEL, `/internal/takeover/${encodeURIComponent(waUserId)}`), {
      method: 'DELETE',
      headers: getHeaders(),
    });
  },
};

// Named export for backward compatibility
// These are shorthand methods that map to the service methods
export const apiClient = {
  channel,
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
  
  async getTickets() {
    const response = await caseService.getTiket();
    return response.json();
  },
  
  async getTicketById(id: string) {
    const response = await caseService.getTiketById(id);
    return response.json();
  },
  
  async updateTicketStatus(id: string, data: { status: string; admin_notes?: string }) {
    const response = await caseService.updateTiketStatus(id, { status: data.status, notes: data.admin_notes });
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
