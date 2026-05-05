/**
 * Frontend API Client
 * 
 * Client-side API calls yang memanggil API routes dashboard (/api/*)
 * API routes dashboard kemudian forward ke backend services sesuai ENV
 * 
 * Browser → Dashboard API Routes → Backend Services
 */

function getAuthHeaders(): Record<string, string> {
  return {
    'Content-Type': 'application/json',
  };
}

let csrfTokenPromise: Promise<string | null> | null = null;

async function getCsrfHeaders(method?: string): Promise<Record<string, string>> {
  const normalizedMethod = (method || 'GET').toUpperCase();
  if (['GET', 'HEAD', 'OPTIONS'].includes(normalizedMethod) || typeof window === 'undefined') return {};

  csrfTokenPromise ??= fetch('/api/csrf', { credentials: 'same-origin' })
    .then((response) => response.ok ? response.json() : null)
    .then((data) => data?.csrfToken || null)
    .catch(() => null);

  const token = await csrfTokenPromise;
  return token ? { 'x-csrf-token': token } : {};
}

// Fetch wrapper with error handling
async function fetchApi<T>(url: string, options: RequestInit = {}): Promise<T> {
  const csrfHeaders = await getCsrfHeaders(options.method);
  const response = await fetch(url, {
    ...options,
    credentials: 'same-origin',
    headers: {
      ...getAuthHeaders(),
      ...csrfHeaders,
      ...options.headers,
    },
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({ error: 'Request failed' }));
    throw new Error(error.error || error.message || 'Request failed');
  }

  return response.json();
}

// Fetch wrapper that returns raw Response (for handlers that need status codes or custom parsing)
export async function fetchApiRaw(url: string, options: RequestInit = {}): Promise<Response> {
  const csrfHeaders = await getCsrfHeaders(options.method);
  return fetch(url, {
    ...options,
    credentials: 'same-origin',
    headers: {
      ...getAuthHeaders(),
      ...csrfHeaders,
      ...options.headers,
    },
  });
}

// ==================== AUTH ====================
export const auth = {
  async login(username: string, password: string) {
    return fetchApi<{ success: boolean; user: any }>('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ username, password }),
    });
  },

  async logout() {
    return fetchApi<{ success: boolean }>('/api/auth/logout', {
      method: 'POST',
    });
  },

  async me() {
    return fetchApi<{ user: any }>('/api/auth/me');
  },

  async updateProfile(data: { name?: string }) {
    return fetchApi<{ success: boolean }>('/api/auth/profile', {
      method: 'PATCH',
      body: JSON.stringify(data),
    });
  },

  async changePassword(data: { currentPassword: string; newPassword: string }) {
    return fetchApi<{ success: boolean }>('/api/auth/password', {
      method: 'PATCH',
      body: JSON.stringify(data),
    });
  },
};

export const dashboard = {
  async getRealtimeSummary() {
    return fetchApi<{
      data: {
        urgentComplaints: any[]
        urgentCount: number
        recentComplaints: any[]
        todayCount: number
        lastHourCount: number
      }
    }>('/api/dashboard/realtime-summary')
  },
};

// ==================== LAPORAN ====================
export const laporan = {
  async getAll(params?: { status?: string; search?: string; limit?: string; offset?: string }) {
    const searchParams = new URLSearchParams();
    if (params?.status) searchParams.set('status', params.status);
    if (params?.search) searchParams.set('search', params.search);
    if (params?.limit) searchParams.set('limit', params.limit);
    if (params?.offset) searchParams.set('offset', params.offset);
    
    const query = searchParams.toString();
    return fetchApi<{ data: any[]; pagination: any }>(`/api/laporan${query ? `?${query}` : ''}`);
  },

  async getById(id: string) {
    return fetchApi<any>(`/api/laporan/${id}`);
  },

  async updateStatus(id: string, data: { status: string; admin_notes?: string }) {
    return fetchApi<any>(`/api/laporan/${id}/status`, {
      method: 'PATCH',
      body: JSON.stringify(data),
    });
  },

  async softDelete(id: string) {
    return fetchApi<{ success: boolean }>(`/api/laporan/${id}/soft-delete`, {
      method: 'PATCH',
    });
  },

  async restore(id: string) {
    return fetchApi<{ success: boolean }>(`/api/laporan/${id}/restore`, {
      method: 'PATCH',
    });
  },

  async getDeleted() {
    return fetchApi<{ data: any[] }>('/api/laporan/deleted');
  },
};

// ==================== LAYANAN ====================
export const layanan = {
  async getAll() {
    return fetchApi<any>('/api/layanan');
  },

  async getActive() {
    return fetchApi<any>('/api/layanan/active');
  },

  async create(data: any) {
    return fetchApi<any>('/api/layanan', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  },

  async update(id: string, data: any) {
    return fetchApi<any>(`/api/layanan/${id}`, {
      method: 'PUT',
      body: JSON.stringify(data),
    });
  },

  async delete(id: string) {
    return fetchApi<any>(`/api/layanan/${id}`, {
      method: 'DELETE',
    });
  },

  async getCategories() {
    return fetchApi<any>('/api/layanan/categories');
  },

  async createCategory(data: any) {
    return fetchApi<any>('/api/layanan/categories', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  },

  async updateCategory(id: string, data: any) {
    return fetchApi<any>(`/api/layanan/categories/${id}`, {
      method: 'PUT',
      body: JSON.stringify(data),
    });
  },

  async deleteCategory(id: string) {
    return fetchApi<any>(`/api/layanan/categories/${id}`, {
      method: 'DELETE',
    });
  },

  async getRequirements(serviceId: string) {
    return fetchApi<any>(`/api/layanan/${serviceId}/requirements`);
  },

  async createRequirement(serviceId: string, data: any) {
    return fetchApi<any>(`/api/layanan/${serviceId}/requirements`, {
      method: 'POST',
      body: JSON.stringify(data),
    });
  },

  async updateRequirement(id: string, data: any) {
    return fetchApi<any>(`/api/layanan/requirements/${id}`, {
      method: 'PUT',
      body: JSON.stringify(data),
    });
  },

  async deleteRequirement(id: string) {
    return fetchApi<any>(`/api/layanan/requirements/${id}`, {
      method: 'DELETE',
    });
  },
};

// ==================== STATISTICS ====================
export const statistics = {
  async getOverview() {
    return fetchApi<any>('/api/statistics/overview');
  },

  async getTrends(period: string = 'weekly') {
    return fetchApi<any>(`/api/statistics/trends?period=${period}`);
  },

  async getAiUsage() {
    return fetchApi<any>('/api/statistics/ai-usage');
  },
};

// ==================== LIVECHAT ====================
export const livechat = {
  async getConversations(status: string = 'all') {
    return fetchApi<any>(`/api/livechat/conversations?status=${status}`);
  },

  async getConversation(waUserId: string) {
    return fetchApi<any>(`/api/livechat/conversations/${encodeURIComponent(waUserId)}`);
  },

  async deleteConversation(waUserId: string) {
    return fetchApi<any>(`/api/livechat/conversations/${encodeURIComponent(waUserId)}`, {
      method: 'DELETE',
    });
  },

  async sendMessage(waUserId: string, message: string) {
    return fetchApi<any>(`/api/livechat/conversations/${encodeURIComponent(waUserId)}/send`, {
      method: 'POST',
      body: JSON.stringify({ message }),
    });
  },

  async retryMessage(waUserId: string, messageId: string) {
    return fetchApi<any>(`/api/livechat/conversations/${encodeURIComponent(waUserId)}/retry`, {
      method: 'POST',
      body: JSON.stringify({ messageId }),
    });
  },

  async markAsRead(waUserId: string) {
    return fetchApi<any>(`/api/livechat/conversations/${encodeURIComponent(waUserId)}/read`, {
      method: 'POST',
    });
  },

  async getTakeovers() {
    return fetchApi<any>('/api/livechat/takeover');
  },

  async getTakeoverStatus(waUserId: string) {
    return fetchApi<any>(`/api/livechat/takeover/${encodeURIComponent(waUserId)}/status`);
  },

  async startTakeover(waUserId: string, adminId: string, adminName: string) {
    return fetchApi<any>(`/api/livechat/takeover/${encodeURIComponent(waUserId)}`, {
      method: 'POST',
      body: JSON.stringify({ admin_id: adminId, admin_name: adminName }),
    });
  },

  async endTakeover(waUserId: string) {
    return fetchApi<any>(`/api/livechat/takeover/${encodeURIComponent(waUserId)}`, {
      method: 'DELETE',
    });
  },

  async getProcessingStatus() {
    return fetchApi<any>('/api/livechat/processing-status');
  },
};

// ==================== KNOWLEDGE ====================
export const knowledge = {
  async getAll(params?: Record<string, string>) {
    const searchParams = params ? new URLSearchParams(params).toString() : '';
    return fetchApi<any>(`/api/knowledge${searchParams ? `?${searchParams}` : ''}`);
  },

  async getById(id: string) {
    return fetchApi<any>(`/api/knowledge/${id}`);
  },

  async create(data: any) {
    return fetchApi<any>('/api/knowledge', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  },

  async update(id: string, data: any) {
    return fetchApi<any>(`/api/knowledge/${id}`, {
      method: 'PUT',
      body: JSON.stringify(data),
    });
  },

  async delete(id: string) {
    return fetchApi<any>(`/api/knowledge/${id}`, {
      method: 'DELETE',
    });
  },

  async embedAll() {
    return fetchApi<any>('/api/knowledge/embed-all', {
      method: 'POST',
    });
  },

  async embed(id: string) {
    return fetchApi<any>(`/api/knowledge/${id}/embed`, {
      method: 'POST',
    });
  },

  async getCategories() {
    return fetchApi<any>('/api/knowledge/categories');
  },

  async createCategory(data: any) {
    return fetchApi<any>('/api/knowledge/categories', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  },
};

// ==================== DOCUMENTS ====================
export const documents = {
  async getAll(params?: Record<string, string>) {
    const searchParams = params ? new URLSearchParams(params).toString() : '';
    return fetchApi<any>(`/api/documents${searchParams ? `?${searchParams}` : ''}`);
  },

  async getById(id: string) {
    return fetchApi<any>(`/api/documents/${id}`);
  },

  async getStats() {
    return fetchApi<any>('/api/documents/stats');
  },

  async upload(formData: FormData, onUploadProgress?: (progress: number) => void) {
    if (!onUploadProgress) {
      const response = await fetch('/api/documents', {
        method: 'POST',
        credentials: 'same-origin',
        body: formData,
      });
      if (!response.ok) {
        const error = await response.json().catch(() => ({ error: 'Upload failed' }));
        throw new Error(error.error || 'Upload failed');
      }
      return response.json();
    }

    return new Promise<any>((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open('POST', '/api/documents');
      xhr.withCredentials = true;
      xhr.upload.onprogress = (event) => {
        if (event.lengthComputable) {
          onUploadProgress(Math.min(95, Math.round((event.loaded / event.total) * 95)));
        }
      };
      xhr.onload = () => {
        const payload = JSON.parse(xhr.responseText || '{}');
        if (xhr.status >= 200 && xhr.status < 300) {
          onUploadProgress(100);
          resolve(payload);
        } else {
          reject(new Error(payload?.error || 'Upload failed'));
        }
      };
      xhr.onerror = () => reject(new Error('Upload failed'));
      xhr.send(formData);
    });
  },

  async delete(id: string) {
    return fetchApi<any>(`/api/documents/${id}`, {
      method: 'DELETE',
    });
  },

  async update(id: string, data: any) {
    return fetchApi<any>(`/api/documents/${id}`, {
      method: 'PUT',
      body: JSON.stringify(data),
    });
  },

  async process(id: string) {
    return fetchApi<any>(`/api/documents/${id}/process`, {
      method: 'POST',
    });
  },

  async embedAll() {
    return fetchApi<any>('/api/documents/embed-all', {
      method: 'POST',
    });
  },
};

// ==================== RATE LIMIT ====================
export const rateLimit = {
  async getConfig() {
    return fetchApi<any>('/api/rate-limit');
  },

  async getBlacklist() {
    return fetchApi<any>('/api/rate-limit/blacklist');
  },

  async addToBlacklist(waUserId: string, reason: string) {
    return fetchApi<any>('/api/rate-limit/blacklist', {
      method: 'POST',
      body: JSON.stringify({ wa_user_id: waUserId, reason }),
    });
  },

  async removeFromBlacklist(waUserId: string) {
    return fetchApi<any>(`/api/rate-limit/blacklist?wa_user_id=${encodeURIComponent(waUserId)}`, {
      method: 'DELETE',
    });
  },
};

// ==================== SETTINGS ====================
export const settings = {
  async get() {
    return fetchApi<any>('/api/settings');
  },

  async update(data: any) {
    return fetchApi<any>('/api/settings', {
      method: 'PATCH',
      body: JSON.stringify(data),
    });
  },

  async getNotifications() {
    return fetchApi<any>('/api/settings/notifications');
  },

  async updateNotifications(data: any) {
    return fetchApi<any>('/api/settings/notifications', {
      method: 'PATCH',
      body: JSON.stringify(data),
    });
  },
};

// ==================== SUPERADMIN ====================
export const superadmin = {
  async getLLMCheck() {
    return fetchApi<any>('/api/superadmin/llm-check');
  },

  async getVillages() {
    return fetchApi<any>('/api/superadmin/villages');
  },

  async getAdmins() {
    return fetchApi<any>('/api/superadmin/admins');
  },

  async registerAdmin(data: any) {
    return fetchApi<any>('/api/superadmin/register', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  },
};

// ==================== IMPORTANT CONTACTS ====================
export const importantContacts = {
  async getAll() {
    return fetchApi<any>('/api/important-contacts');
  },

  async create(data: any) {
    return fetchApi<any>('/api/important-contacts', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  },

  async update(id: string, data: any) {
    return fetchApi<any>(`/api/important-contacts/${id}`, {
      method: 'PUT',
      body: JSON.stringify(data),
    });
  },

  async delete(id: string) {
    return fetchApi<any>(`/api/important-contacts/${id}`, {
      method: 'DELETE',
    });
  },

  async getCategories() {
    return fetchApi<any>('/api/important-contacts/categories');
  },

  async createCategory(data: any) {
    return fetchApi<any>('/api/important-contacts/categories', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  },

  async updateCategory(id: string, data: any) {
    return fetchApi<any>(`/api/important-contacts/categories/${id}`, {
      method: 'PUT',
      body: JSON.stringify(data),
    });
  },

  async deleteCategory(id: string) {
    return fetchApi<any>(`/api/important-contacts/categories/${id}`, {
      method: 'DELETE',
    });
  },
};

// ==================== WHATSAPP / CHANNEL SETTINGS ====================
export const whatsapp = {
  async getStatus(villageParam?: string) {
    const base = villageParam ? `/api/whatsapp/status?${villageParam}` : '/api/whatsapp/status';
    return fetchApi<any>(base);
  },

  async getQR(villageParam?: string) {
    const base = villageParam ? `/api/whatsapp/qr?${villageParam}` : '/api/whatsapp/qr';
    return fetchApi<any>(base);
  },

  async checkDuplicate(waNumber: string, villageParam?: string) {
    const base = `/api/whatsapp/check-duplicate?wa_number=${encodeURIComponent(waNumber)}${villageParam ? `&${villageParam}` : ''}`;
    return fetchApi<any>(base);
  },

  async forceDisconnect(villageParam?: string) {
    const base = villageParam ? `/api/whatsapp/force-disconnect?${villageParam}` : '/api/whatsapp/force-disconnect';
    return fetchApi<any>(base, { method: 'POST' });
  },

  async createSession(villageParam?: string) {
    const base = villageParam ? `/api/whatsapp/session?${villageParam}` : '/api/whatsapp/session';
    return fetchApi<any>(base, { method: 'POST' });
  },

  async deleteSession(villageParam?: string) {
    const base = villageParam ? `/api/whatsapp/session?${villageParam}` : '/api/whatsapp/session';
    return fetchApi<any>(base, { method: 'DELETE' });
  },

  async disconnect(villageParam?: string) {
    const base = villageParam ? `/api/whatsapp/disconnect?${villageParam}` : '/api/whatsapp/disconnect';
    return fetchApi<any>(base, { method: 'POST' });
  },

  async connect(data: any, villageParam?: string) {
    const base = villageParam ? `/api/whatsapp/connect?${villageParam}` : '/api/whatsapp/connect';
    return fetchApi<any>(base, {
      method: 'POST',
      body: JSON.stringify(data),
    });
  },
};

export const channelSettings = {
  async get(villageParam?: string) {
    const base = villageParam ? `/api/channel-settings?${villageParam}` : '/api/channel-settings';
    return fetchApi<any>(base);
  },

  async update(data: any, villageParam?: string) {
    const base = villageParam ? `/api/channel-settings?${villageParam}` : '/api/channel-settings';
    return fetchApi<any>(base, {
      method: 'PATCH',
      body: JSON.stringify(data),
    });
  },
};

// ==================== COMPLAINTS (PENGADUAN) ====================
export const complaints = {
  async getCategories() {
    return fetchApi<any>('/api/complaints/categories');
  },

  async createCategory(data: any) {
    return fetchApi<any>('/api/complaints/categories', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  },

  async updateCategory(id: string, data: any) {
    return fetchApi<any>(`/api/complaints/categories/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(data),
    });
  },

  async deleteCategory(id: string) {
    return fetchApi<any>(`/api/complaints/categories/${id}`, {
      method: 'DELETE',
    });
  },

  async getTypes() {
    return fetchApi<any>('/api/complaints/types');
  },

  async createType(data: any) {
    return fetchApi<any>('/api/complaints/types', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  },

  async updateType(id: string, data: any) {
    return fetchApi<any>(`/api/complaints/types/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(data),
    });
  },

  async deleteType(id: string) {
    return fetchApi<any>(`/api/complaints/types/${id}`, {
      method: 'DELETE',
    });
  },
};

// ==================== VILLAGE PROFILE ====================
export const villageProfile = {
  async get() {
    return fetchApi<any>('/api/village-profile');
  },

  async update(data: any) {
    return fetchApi<any>('/api/village-profile', {
      method: 'PUT',
      body: JSON.stringify(data),
    });
  },
};

// ==================== VILLAGES ====================
export const villages = {
  async getMe() {
    return fetchApi<any>('/api/villages/me');
  },
};

// ==================== SERVICE REQUESTS (PELAYANAN) ====================
export const serviceRequests = {
  async getAll(params?: Record<string, string>) {
    const searchParams = params ? new URLSearchParams(params).toString() : '';
    return fetchApi<any>(`/api/service-requests${searchParams ? `?${searchParams}` : ''}`);
  },

  async getById(id: string) {
    return fetchApi<any>(`/api/service-requests/${id}`);
  },

  async updateStatus(id: string, data: any) {
    return fetchApi<any>(`/api/service-requests/${id}/status`, {
      method: 'PATCH',
      body: JSON.stringify(data),
    });
  },

  async softDelete(id: string) {
    return fetchApi<any>(`/api/service-requests/${id}/soft-delete`, {
      method: 'PATCH',
    });
  },

  async restore(id: string) {
    return fetchApi<any>(`/api/service-requests/${id}/restore`, {
      method: 'PATCH',
    });
  },

  async getDeleted() {
    return fetchApi<any>('/api/service-requests/deleted');
  },
};

// ==================== KNOWLEDGE ANALYTICS ====================
export const knowledgeAnalytics = {
  async get() {
    return fetchApi<any>('/api/statistics/knowledge-analytics');
  },

  async deleteGap(id: string) {
    return fetchApi<any>(`/api/knowledge-gaps/${id}`, {
      method: 'DELETE',
    });
  },

  async deleteGapsBatch(ids: string[]) {
    return fetchApi<any>('/api/knowledge-gaps/batch', {
      method: 'DELETE',
      body: JSON.stringify({ ids }),
    });
  },

  async deleteConflictsBatch(ids: string[]) {
    return fetchApi<any>('/api/knowledge-conflicts/batch', {
      method: 'DELETE',
      body: JSON.stringify({ ids }),
    });
  },
};

// ==================== CACHE ====================
export const cache = {
  async get() {
    return fetchApi<any>('/api/cache');
  },

  async clearAll() {
    return fetchApi<any>('/api/cache', {
      method: 'POST',
      body: JSON.stringify({ action: 'clear-all' }),
    });
  },

  async setMode(mode: string) {
    return fetchApi<any>('/api/cache', {
      method: 'POST',
      body: JSON.stringify({ action: 'set-mode', mode }),
    });
  },
};

// ==================== SPAM GUARD ====================
export const spamGuard = {
  async get() {
    return fetchApi<any>('/api/spam-guard');
  },

  async remove(waUserId: string) {
    return fetchApi<any>(`/api/spam-guard?wa_user_id=${encodeURIComponent(waUserId)}`, {
      method: 'DELETE',
    });
  },
};

// ==================== UPLOADS ====================
export const uploads = {
  async upload(formData: FormData) {
    const response = await fetch('/api/uploads', {
      method: 'POST',
      credentials: 'same-origin',
      body: formData,
    });
    if (!response.ok) {
      const error = await response.json().catch(() => ({ error: 'Upload failed' }));
      throw new Error(error.error || 'Upload failed');
    }
    return response.json();
  },
};

// ==================== BACKWARD COMPATIBLE EXPORTS ====================
// Untuk kompatibilitas dengan kode yang sudah ada
export const apiClient = {
  ...auth,
  getComplaints: laporan.getAll,
  getComplaintById: laporan.getById,
  updateComplaintStatus: laporan.updateStatus,
  getStatistics: statistics.getOverview,
  getTrends: statistics.getTrends,
  livechat,
  knowledge,
  documents,
  rateLimit,
  settings,
  superadmin,
  importantContacts,
  whatsapp,
  channelSettings,
  complaints,
  villageProfile,
  villages,
  serviceRequests,
  knowledgeAnalytics,
  cache,
  spamGuard,
  uploads,
  getServices: layanan.getAll,
  getActiveServices: layanan.getActive,
};

export default apiClient;
