/**
 * WA Support V2 Client for GovConnect Channel Service
 *
 * Handles all communication with genfity-wa-support-v2 service.
 *
 * Authentication layers:
 * - Internal API Key (x-internal-api-key): Service-to-service calls (create/manage users)
 * - Customer API Key (x-api-key): Per-user operations (session management)
 * - Session Token (token header): WA gateway operations (send messages, etc.)
 */

import axios, { AxiosInstance, AxiosError } from 'axios';

// ============================================================================
// Types
// ============================================================================

export interface WaSupportResult<T = any> {
  success: boolean;
  error?: {
    type: 'NETWORK_ERROR' | 'TIMEOUT' | 'AUTH_ERROR' | 'SERVER_ERROR' | 'CONFIG_ERROR' | 'VALIDATION_ERROR';
    message: string;
    statusCode?: number;
  };
  data?: T;
}

export interface WaSupportUser {
  id: string;
  source_service: string;
  customer_api_key?: string;
  status: string;
  created_at: string;
  updated_at: string;
}

export interface WaSupportSubscription {
  id: number;
  user_id: string;
  provider: string;
  max_sessions: number;
  max_messages: number;
  expires_at: string;
  status: string;
  created_at: string;
  updated_at: string;
}

export interface WaSupportSession {
  id: number;
  user_id: string;
  provider: string;
  session_id: string;
  session_name: string;
  session_token: string;
  webhook_url: string;
  connected: boolean;
  logged_in: boolean;
  jid: string;
  status: string;
  last_synced_at: string | null;
  last_activity_at: string | null;
  last_message_sent: number;
  last_message_fail: number;
  created_at: string;
  updated_at: string;
}

export interface WaSupportSessionSettings {
  session_id: string;
  webhook_url: string;
  message_stat_sent: number;
  message_stat_failed: number;
}

export interface WaSupportContact {
  id: number;
  user_id: string;
  session_id: string;
  jid: string;
  name: string;
  phone: string;
  raw: any;
  last_synced_at: string;
}

export interface WaSupportUserInfo {
  user: WaSupportUser;
  subscription: WaSupportSubscription | null;
}

export interface WaSupportUserListItem {
  id: string;
  source_service: string;
  status: string;
  created_at: string;
  subscription: WaSupportSubscription | null;
  session_count: number;
}

export interface CreateUserRequest {
  user_id: string;
  source: string;
  expires_at: string;
  max_sessions: number;
  max_messages?: number;
  provider?: string;
  created_by?: string;
}

export interface CreateSessionRequest {
  session_name: string;
  webhook_url?: string;
  events?: string;
  expiration_sec?: number;
  auto_connect?: boolean;
  history?: boolean;
}

export interface UpdateSessionRequest {
  session_name?: string;
  webhook_url?: string;
  events?: string;
  expiration_sec?: number;
  history?: boolean;
}

export interface UpdateSessionSettingsRequest {
  webhook_url?: string;
}

// ============================================================================
// Client Class
// ============================================================================

class WaSupportClient {
  private baseUrl: string;
  private internalApiKey: string;
  private http: AxiosInstance;

  constructor() {
    this.baseUrl = (process.env.WA_SUPPORT_URL || '').replace(/\/$/, '');

    // WA_SUPPORT_INTERNAL_API_KEY may be in "source:actualKey" format (e.g. "govconnect:govconnect2026").
    // The wa-support middleware expects only the actualKey portion in the header.
    const rawKey = process.env.WA_SUPPORT_INTERNAL_API_KEY || '';
    this.internalApiKey = rawKey.includes(':') ? rawKey.split(':').slice(1).join(':') : rawKey;

    this.http = axios.create({
      timeout: 30000,
    });
  }

  // --------------------------------------------------------------------------
  // Helpers
  // --------------------------------------------------------------------------

  isConfigured(): boolean {
    return !!(this.baseUrl && this.internalApiKey);
  }

  private internalHeaders(): Record<string, string> {
    return {
      'Content-Type': 'application/json',
      'x-internal-api-key': this.internalApiKey,
    };
  }

  private customerHeaders(apiKey: string): Record<string, string> {
    return {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
    };
  }

  private sessionTokenHeaders(token: string): Record<string, string> {
    return {
      'Content-Type': 'application/json',
      token,
    };
  }

  private handleError<T>(error: unknown): WaSupportResult<T> {
    if (axios.isAxiosError(error)) {
      const axErr = error as AxiosError<any>;
      const status = axErr.response?.status;
      const data = axErr.response?.data;

      let type: NonNullable<WaSupportResult['error']>['type'] = 'SERVER_ERROR';
      if (!axErr.response) type = axErr.code === 'ECONNABORTED' ? 'TIMEOUT' : 'NETWORK_ERROR';
      else if (status === 401 || status === 403) type = 'AUTH_ERROR';
      else if (status === 400 || status === 422) type = 'VALIDATION_ERROR';

      return {
        success: false,
        error: {
          type,
          message: data?.error || data?.message || axErr.message,
          statusCode: status,
        },
      };
    }

    return {
      success: false,
      error: {
        type: 'NETWORK_ERROR',
        message: error instanceof Error ? error.message : 'Unknown error',
      },
    };
  }

  // ============================================================================
  // INTERNAL API — service-to-service (requires internal API key)
  // ============================================================================

  /** Check internal API key info */
  async getInternalMe(): Promise<WaSupportResult> {
    try {
      const res = await this.http.get(`${this.baseUrl}/internal/me`, {
        headers: this.internalHeaders(),
      });
      return { success: true, data: res.data };
    } catch (err) {
      return this.handleError(err);
    }
  }

  /** List all users with subscription + session counts */
  async listUsers(params?: {
    source?: string;
    provider?: string;
    page?: number;
    limit?: number;
  }): Promise<WaSupportResult<{ items: WaSupportUserListItem[]; meta: any }>> {
    try {
      const res = await this.http.get(`${this.baseUrl}/internal/users`, {
        headers: this.internalHeaders(),
        params: {
          source: params?.source || 'govconnect',
          provider: params?.provider,
          page: params?.page,
          limit: params?.limit,
        },
      });
      return { success: true, data: res.data };
    } catch (err) {
      return this.handleError(err);
    }
  }

  /** Create or upsert user with subscription. Returns api_key ONLY on first creation. */
  async createUser(data: CreateUserRequest): Promise<WaSupportResult<{ user_id: string; api_key?: string; note?: string }>> {
    try {
      const res = await this.http.post(`${this.baseUrl}/internal/users`, data, {
        headers: this.internalHeaders(),
      });
      return { success: true, data: res.data };
    } catch (err) {
      return this.handleError(err);
    }
  }

  /** Update user source + subscription */
  async updateUser(userId: string, data: Partial<CreateUserRequest>): Promise<WaSupportResult> {
    try {
      const res = await this.http.put(`${this.baseUrl}/internal/users/${userId}`, data, {
        headers: this.internalHeaders(),
      });
      return { success: true, data: res.data };
    } catch (err) {
      return this.handleError(err);
    }
  }

  /** Get user API key metadata */
  async getUserApiKeyInfo(userId: string): Promise<WaSupportResult> {
    try {
      const res = await this.http.get(`${this.baseUrl}/internal/users/${userId}/apikey`, {
        headers: this.internalHeaders(),
      });
      return { success: true, data: res.data };
    } catch (err) {
      return this.handleError(err);
    }
  }

  /** Rotate customer API key — returns new plaintext key */
  async rotateUserApiKey(userId: string): Promise<WaSupportResult<{ user_id: string; api_key: string }>> {
    try {
      const res = await this.http.post(`${this.baseUrl}/internal/users/${userId}/apikey/rotate`, {}, {
        headers: this.internalHeaders(),
      });
      return { success: true, data: res.data };
    } catch (err) {
      return this.handleError(err);
    }
  }

  // ============================================================================
  // CUSTOMER API — per-user operations (requires customer x-api-key)
  // ============================================================================

  /** Get current user info + subscription */
  async getCustomerMe(apiKey: string): Promise<WaSupportResult<WaSupportUserInfo>> {
    try {
      const res = await this.http.get(`${this.baseUrl}/v1/me`, {
        headers: this.customerHeaders(apiKey),
      });
      return { success: true, data: res.data };
    } catch (err) {
      return this.handleError(err);
    }
  }

  /** List customer sessions */
  async listCustomerSessions(apiKey: string): Promise<WaSupportResult<{ sessions: WaSupportSession[] }>> {
    try {
      const res = await this.http.get(`${this.baseUrl}/v1/sessions`, {
        headers: this.customerHeaders(apiKey),
      });
      return { success: true, data: res.data };
    } catch (err) {
      return this.handleError(err);
    }
  }

  /** Create a new WA session (enforces max_sessions from subscription) */
  async createCustomerSession(apiKey: string, data: CreateSessionRequest): Promise<WaSupportResult<{ session: WaSupportSession }>> {
    try {
      const res = await this.http.post(`${this.baseUrl}/v1/sessions`, data, {
        headers: this.customerHeaders(apiKey),
      });
      return { success: true, data: res.data };
    } catch (err) {
      return this.handleError(err);
    }
  }

  /** Delete a session */
  async deleteCustomerSession(apiKey: string, sessionId: string): Promise<WaSupportResult> {
    try {
      const res = await this.http.delete(`${this.baseUrl}/v1/sessions/${sessionId}`, {
        headers: this.customerHeaders(apiKey),
      });
      return { success: true, data: res.data };
    } catch (err) {
      return this.handleError(err);
    }
  }

  /** Get session settings + message stats */
  async getSessionSettings(apiKey: string, sessionId: string): Promise<WaSupportResult<WaSupportSessionSettings>> {
    try {
      const res = await this.http.get(`${this.baseUrl}/v1/sessions/${sessionId}/settings`, {
        headers: this.customerHeaders(apiKey),
      });
      return { success: true, data: res.data };
    } catch (err) {
      return this.handleError(err);
    }
  }

  /** Update session settings */
  async updateSessionSettings(apiKey: string, sessionId: string, data: UpdateSessionSettingsRequest): Promise<WaSupportResult> {
    try {
      const res = await this.http.put(`${this.baseUrl}/v1/sessions/${sessionId}/settings`, data, {
        headers: this.customerHeaders(apiKey),
      });
      return { success: true, data: res.data };
    } catch (err) {
      return this.handleError(err);
    }
  }

  /** List contacts for a session */
  async getSessionContacts(apiKey: string, sessionId: string, sync: boolean = true): Promise<WaSupportResult<{ contacts: WaSupportContact[] }>> {
    try {
      const res = await this.http.get(`${this.baseUrl}/v1/sessions/${sessionId}/contacts`, {
        headers: this.customerHeaders(apiKey),
        params: { sync },
      });
      return { success: true, data: res.data };
    } catch (err) {
      return this.handleError(err);
    }
  }

  // ============================================================================
  // WA GATEWAY — proxy requests via session token
  // ============================================================================

  /** Generic WA gateway request */
  async waGateway(sessionToken: string, path: string, method: string = 'GET', body?: any): Promise<WaSupportResult> {
    try {
      const url = `${this.baseUrl}/v1/wa${path.startsWith('/') ? path : `/${path}`}`;
      const res = await this.http.request({
        url,
        method,
        headers: this.sessionTokenHeaders(sessionToken),
        data: body,
      });
      return { success: true, data: res.data };
    } catch (err) {
      return this.handleError(err);
    }
  }

  /** Get session status from WA gateway */
  async getSessionStatus(sessionToken: string): Promise<WaSupportResult> {
    return this.waGateway(sessionToken, '/session/status');
  }

  /** Get QR code for session */
  async getSessionQR(sessionToken: string): Promise<WaSupportResult> {
    return this.waGateway(sessionToken, '/session/qr');
  }

  /** Connect/start a session */
  async connectSession(sessionToken: string): Promise<WaSupportResult> {
    return this.waGateway(sessionToken, '/session/connect');
  }

  /** Logout a session */
  async logoutSession(sessionToken: string): Promise<WaSupportResult> {
    return this.waGateway(sessionToken, '/session/logout', 'POST');
  }

  /** Send text message */
  async sendTextMessage(sessionToken: string, phone: string, body: string): Promise<WaSupportResult> {
    return this.waGateway(sessionToken, '/chat/send/text', 'POST', { Phone: phone, Body: body });
  }

  /** Send typing indicator */
  async sendTypingIndicator(sessionToken: string, phone: string, state: string = 'composing'): Promise<WaSupportResult> {
    return this.waGateway(sessionToken, '/chat/presence', 'POST', { Phone: phone, State: state, Media: '' });
  }

  /** Mark messages as read */
  async markAsRead(sessionToken: string, messageIds: string[], chatPhone: string, senderPhone: string): Promise<WaSupportResult> {
    return this.waGateway(sessionToken, '/chat/markread', 'POST', {
      Id: messageIds,
      ChatPhone: chatPhone,
      SenderPhone: senderPhone,
    });
  }

  /** Pair phone for linking code auth */
  async pairPhone(sessionToken: string, phone: string): Promise<WaSupportResult> {
    return this.waGateway(sessionToken, '/session/pairphone', 'POST', { Phone: phone });
  }
}

// Export singleton
export const waSupportClient = new WaSupportClient();
export default waSupportClient;
