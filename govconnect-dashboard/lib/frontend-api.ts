/**
 * Frontend API Client
 * 
 * Client-side API calls yang memanggil API routes dashboard (/api/*)
 * API routes dashboard kemudian forward ke backend services sesuai ENV
 * 
 * Browser → Dashboard API Routes → Backend Services
 */

// Get auth token from localStorage
function getAuthToken(): string | null {
  if (typeof window === 'undefined') return null;
  return localStorage.getItem('token');
}

// Get headers with auth token
function getAuthHeaders(): Record<string, string> {
  const token = getAuthToken();
  return {
    'Content-Type': 'application/json',
    ...(token ? { 'Authorization': `Bearer ${token}` } : {}),
  };
}

// Fetch wrapper with error handling
async function fetchApi<T>(url: string, options: RequestInit = {}): Promise<T> {
  const response = await fetch(url, {
    ...options,
    headers: {
      ...getAuthHeaders(),
      ...options.headers,
    },
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({ error: 'Request failed' }));
    throw new Error(error.error || error.message || 'Request failed');
  }

  return response.json();
}

// ==================== AUTH ====================
export const auth = {
  async login(username: string, password: string) {
    const data = await fetchApi<{ success: boolean; token: string }>('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ username, password }),
    });
    if (data.token) {
      localStorage.setItem('token', data.token);
    }
    return data;
  },

  async logout() {
    const data = await fetchApi<{ success: boolean }>('/api/auth/logout', {
      method: 'POST',
    });
    localStorage.removeItem('token');
    return data;
  },

  async me() {
    return fetchApi<{ admin: any }>('/api/auth/me');
  },

  async updateProfile(data: { name?: string }) {
    return fetchApi<{ success: boolean }>('/api/auth/profile', {
      method: 'PATCH',
      body: JSON.stringify(data),
    });
  },

  async changePassword(data: { currentPassword: string; newPassword: string }) {
    return fetchApi<{ success: boolean }>('/api/auth/password', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  },
};

// ==================== LAPORAN ====================
export const laporan = {
  async getAll(params?: { status?: string; limit?: string; offset?: string }) {
    const searchParams = new URLSearchParams();
    if (params?.status) searchParams.set('status', params.status);
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
};

// ==================== STATISTICS ====================
export const statistics = {
  async getOverview() {
    return fetchApi<any>('/api/statistics/overview');
  },

  async getTrends(period: string = 'week') {
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
};

// ==================== KNOWLEDGE ====================
export const knowledge = {
  async getAll() {
    return fetchApi<any>('/api/knowledge');
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
};

// ==================== DOCUMENTS ====================
export const documents = {
  async getAll() {
    return fetchApi<any>('/api/documents');
  },

  async getById(id: string) {
    return fetchApi<any>(`/api/documents/${id}`);
  },

  async upload(formData: FormData) {
    const token = getAuthToken();
    const response = await fetch('/api/documents', {
      method: 'POST',
      headers: token ? { 'Authorization': `Bearer ${token}` } : {},
      body: formData,
    });
    if (!response.ok) {
      const error = await response.json().catch(() => ({ error: 'Upload failed' }));
      throw new Error(error.error || 'Upload failed');
    }
    return response.json();
  },

  async delete(id: string) {
    return fetchApi<any>(`/api/documents/${id}`, {
      method: 'DELETE',
    });
  },

  async process(id: string) {
    return fetchApi<any>(`/api/documents/${id}/process`, {
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
    return fetchApi<any>(`/api/rate-limit/blacklist/${encodeURIComponent(waUserId)}`, {
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

// ==================== BACKWARD COMPATIBLE EXPORTS ====================
// Untuk kompatibilitas dengan kode yang sudah ada
export const apiClient = {
  // Auth
  ...auth,
  
  // Laporan (complaints)
  getComplaints: laporan.getAll,
  getComplaintById: laporan.getById,
  updateComplaintStatus: laporan.updateStatus,
  
  // Statistics
  getStatistics: statistics.getOverview,
  getTrends: statistics.getTrends,
  
  // Livechat
  livechat,
  
  // Knowledge
  knowledge,
  
  // Documents
  documents,
  
  // Rate Limit
  rateLimit,
  
  // Settings
  settings,
  
  // Layanan
  getServices: layanan.getAll,
  getActiveServices: layanan.getActive,
};

export default apiClient;
