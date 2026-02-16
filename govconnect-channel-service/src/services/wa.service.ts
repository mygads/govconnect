import axios from 'axios';
import logger from '../utils/logger';
import { config } from '../config/env';
import prisma from '../config/database';
import { waSupportClient } from '../clients/wa-support.client';

// In-memory settings cache (since we're using single session)
// Default typingIndicator to true so AI shows "typing..." while processing
let sessionSettings = {
  autoReadMessages: false,
  typingIndicator: true,
};

function isDryRun(): boolean {
  return (process.env.WA_DRY_RUN || '').toLowerCase() === 'true';
}

async function getSessionByVillageId(villageId: string) {
  return prisma.wa_sessions.findUnique({
    where: { village_id: villageId },
  });
}

/**
 * Look up a WA session by instance_name (the slug used on the WA provider).
 * This is needed because the webhook sends instanceName (slug) but the DB stores village_id (CUID).
 */
async function getSessionByInstanceName(instanceName: string) {
  return prisma.wa_sessions.findUnique({
    where: { instance_name: instanceName },
  });
}

/**
 * Resolve village_id from an instanceName (slug).
 * Returns the CUID village_id if found via instance_name lookup,
 * otherwise returns the input as-is (backward compatible).
 */
export async function resolveVillageIdFromInstanceName(instanceName: string): Promise<string> {
  // First: check if instanceName is already a valid CUID village_id
  const directSession = await getSessionByVillageId(instanceName);
  if (directSession) return instanceName;

  // Second: look up by instance_name (slug → CUID)
  const sessionByName = await getSessionByInstanceName(instanceName);
  if (sessionByName) {
    logger.info('Resolved instance_name to village_id', {
      instance_name: instanceName,
      village_id: sessionByName.village_id,
    });
    return sessionByName.village_id;
  }

  // Fallback: return as-is (may fail downstream, but preserves existing behavior)
  logger.warn('Could not resolve instance_name to village_id, using as-is', { instanceName });
  return instanceName;
}

async function upsertSession(params: {
  villageId: string;
  adminId?: string;
  token: string;
  status?: string;
  waNumber?: string | null;
  instanceName?: string;
  waSupportUserId?: string;
  waSupportApiKey?: string;
  waSupportSessionId?: string;
}) {
  return prisma.wa_sessions.upsert({
    where: { village_id: params.villageId },
    create: {
      village_id: params.villageId,
      instance_name: params.instanceName || null,
      admin_id: params.adminId,
      wa_token: params.token,
      status: params.status || null,
      wa_number: params.waNumber || null,
      wa_support_user_id: params.waSupportUserId || null,
      wa_support_api_key: params.waSupportApiKey || null,
      wa_support_session_id: params.waSupportSessionId || null,
      last_connected_at: params.status === 'connected' ? new Date() : null,
    },
    update: {
      admin_id: params.adminId,
      wa_token: params.token,
      status: params.status || null,
      wa_number: params.waNumber || null,
      instance_name: params.instanceName || undefined,
      wa_support_user_id: params.waSupportUserId || undefined,
      wa_support_api_key: params.waSupportApiKey || undefined,
      wa_support_session_id: params.waSupportSessionId || undefined,
      last_connected_at: params.status === 'connected' ? new Date() : undefined,
    },
  });
}

async function getDefaultChannelAccount(villageId?: string) {
  if (!villageId) return null;

  try {
    return await prisma.channel_accounts.findUnique({
      where: { village_id: villageId },
    });
  } catch (error: any) {
    logger.warn('Failed to load channel account', { error: error.message });
    return null;
  }
}

function getPublicWhatsAppWebhookUrl(): string {
  const base = (process.env.PUBLIC_CHANNEL_BASE_URL || process.env.PUBLIC_BASE_URL || '').replace(/\/$/, '');
  // Channel Service supports multiple webhook paths (/, /webhook, /webhook/whatsapp).
  // Use /webhook as the canonical public URL.
  return base ? `${base}/webhook` : '';
}

/**
 * Ensure a wa-support-v2 user exists for this village.
 * Creates (upsert) via internal API. Returns api_key if newly created,
 * otherwise retrieves stored key from DB or rotates.
 */
export async function ensureWaSupportUser(villageId: string): Promise<{ userId: string; apiKey: string }> {
  if (!waSupportClient.isConfigured()) {
    throw new Error('WA_SUPPORT_URL / WA_SUPPORT_INTERNAL_API_KEY not configured');
  }

  // Check if we already have the api_key stored locally
  const existingSession = await prisma.wa_sessions.findUnique({
    where: { village_id: villageId },
    select: { wa_support_user_id: true, wa_support_api_key: true },
  });

  if (existingSession?.wa_support_api_key) {
    return {
      userId: existingSession.wa_support_user_id || villageId,
      apiKey: existingSession.wa_support_api_key,
    };
  }

  // Create / upsert user on wa-support-v2
  const createResult = await waSupportClient.createUser({
    user_id: villageId,
    source: 'govconnect',
    expires_at: '2099-12-31T23:59:59Z',
    max_sessions: 1,
    max_messages: 0, // unlimited
    provider: 'genfity-wa',
    created_by: 'govconnect-channel-service',
  });

  if (!createResult.success) {
    throw new Error(`Failed to create wa-support user: ${createResult.error?.message}`);
  }

  // api_key is only returned on first creation
  let apiKey = createResult.data?.api_key;

  if (!apiKey) {
    // User already existed, api_key not returned — rotate to get a new one
    logger.info('wa-support user already exists, rotating API key', { userId: villageId });
    const rotateResult = await waSupportClient.rotateUserApiKey(villageId);
    if (!rotateResult.success || !rotateResult.data?.api_key) {
      throw new Error(`Failed to rotate api_key for wa-support user: ${rotateResult.error?.message}`);
    }
    apiKey = rotateResult.data.api_key;
  }

  // Store api_key in local DB (update existing row if any, or it will be saved during upsertSession)
  if (existingSession) {
    await prisma.wa_sessions.update({
      where: { village_id: villageId },
      data: {
        wa_support_user_id: villageId,
        wa_support_api_key: apiKey,
      },
    });
  }

  return { userId: villageId, apiKey };
}

/**
 * Create a WA session via wa-support-v2 customer API.
 * Requires user api_key from ensureWaSupportUser.
 */
async function createSessionViaWaSupport(params: {
  apiKey: string;
  villageId: string;
  villageSlug?: string;
  webhook: string;
}): Promise<{ token: string; sessionId: string }> {
  const sessionName = params.villageSlug || params.villageId.toLowerCase().replace(/[^a-z0-9-]/g, '-');

  const result = await waSupportClient.createCustomerSession(params.apiKey, {
    session_name: sessionName,
    webhook_url: params.webhook || '',
    events: 'All',
    auto_connect: true,
    auto_read_enabled: true,
    typing_enabled: true,
  });

  if (!result.success) {
    throw new Error(`Failed to create session via wa-support: ${result.error?.message}`);
  }

  const session = result.data?.session;
  if (!session?.session_token) {
    throw new Error('Token sesi tidak ditemukan dari wa-support-v2');
  }

  return {
    token: session.session_token,
    sessionId: session.session_id || String(session.id),
  };
}

/**
 * Delete a session from wa-support-v2 via customer API.
 */
async function deleteSessionFromWaSupport(apiKey: string, sessionId: string): Promise<void> {
  if (!waSupportClient.isConfigured() || !apiKey || !sessionId) {
    return;
  }

  try {
    const result = await waSupportClient.deleteCustomerSession(apiKey, sessionId);
    if (result.success) {
      logger.info('Session deleted from wa-support-v2', { sessionId });
    } else if (result.error?.statusCode === 404) {
      logger.debug('Session not found in wa-support-v2, skipping deletion');
    } else {
      throw new Error(result.error?.message || 'Unknown error');
    }
  } catch (error: any) {
    logger.warn('Failed to delete session from wa-support-v2', { sessionId, error: error.message });
  }
}

type ResolvedAccessToken = {
  token: string;
  source: 'session' | 'channel_account' | 'default';
  village_id?: string;
};

async function resolveAccessToken(villageId?: string): Promise<ResolvedAccessToken> {
  if (villageId) {
    // Primary: lookup by village_id (CUID)
    const session = await getSessionByVillageId(villageId);
    if (session?.wa_token) return { token: session.wa_token, source: 'session', village_id: villageId };

    // Fallback: lookup by instance_name (slug like "desa-sanreseng-ade")
    const sessionByName = await getSessionByInstanceName(villageId);
    if (sessionByName?.wa_token) {
      logger.info('Token resolved via instance_name fallback', {
        instance_name: villageId,
        village_id: sessionByName.village_id,
      });
      return { token: sessionByName.wa_token, source: 'session', village_id: sessionByName.village_id };
    }
  }

  const account = await getDefaultChannelAccount(villageId);
  if (account?.wa_token) return { token: account.wa_token, source: 'channel_account', village_id: villageId };
  
  // No fallback to env token - tokens must be in database
  throw new Error(`No WA token found for village ${villageId || 'unknown'}. Please create a session first.`);
}

// Exported for other modules that must call WA provider via session token (e.g., media download).
export async function getAccessTokenForVillage(villageId?: string): Promise<ResolvedAccessToken> {
  return resolveAccessToken(villageId);
}

/**
 * Load settings from database at startup
 */
export async function loadSettingsFromDatabase(): Promise<void> {
  try {
    const settings = await prisma.wa_settings.findFirst({
      where: { id: 'default' },
    });
    
    if (settings) {
      sessionSettings = {
        autoReadMessages: settings.auto_read_messages,
        typingIndicator: settings.typing_indicator,
      };
      logger.info('Settings loaded from database', { sessionSettings });
    } else {
      logger.info('No settings in database, using defaults', { sessionSettings });
    }
  } catch (error: any) {
    logger.warn('Failed to load settings from database', { error: error.message });
  }
}

// =====================================================
// SESSION MANAGEMENT FUNCTIONS
// =====================================================

interface SessionStatus {
  connected: boolean;
  loggedIn: boolean;
  jid?: string;
  qrcode?: string;
  name?: string;
  events?: string;
  webhook?: string;
}

/**
 * Get WhatsApp session status
 * API: GET {WA_API_URL}/session/status
 * Response: { code: 200, data: { connected, loggedIn, jid, name, events, webhook, ... }, success: true }
 */
export async function getSessionStatus(token: string): Promise<SessionStatus> {
  try {
    if (!token) {
      logger.warn('WhatsApp token not configured');
      return { connected: false, loggedIn: false };
    }

    if (isDryRun()) {
      return {
        connected: false,
        loggedIn: false,
        jid: '',
        qrcode: '',
        name: 'dry-run',
        events: 'All',
        webhook: '',
      };
    }

    const url = `${config.WA_API_URL}/session/status`;
    
    const response = await axios.get(url, {
      headers: {
        token,
      },
      timeout: 10000,
    });

    const data = response.data.data || response.data;
    
    // genfity-wa returns lowercase fields
    return {
      connected: data.connected || false,
      loggedIn: data.loggedIn || false,
      jid: data.jid || '',
      qrcode: data.qrcode || '',
      name: data.name || '',
      events: data.events || '',
      webhook: data.webhook || '',
    };
  } catch (error: any) {
    logger.error('Failed to get session status', {
      error: error.message,
      response: error.response?.data,
    });
    return { connected: false, loggedIn: false };
  }
}

/**
 * Get available webhook events
 * API: GET {WA_API_URL}/webhook/events?active=true
 */
export async function getWebhookEvents(villageId?: string): Promise<string[]> {
  try {
    const resolved = await resolveAccessToken(villageId).catch(() => null);
    if (!resolved) {
      return ['Message'];
    }

    const url = `${config.WA_API_URL}/webhook/events?active=true`;
    
    const response = await axios.get(url, {
      headers: {
        token: resolved.token,
      },
      timeout: 10000,
    });

    const data = response.data.data || response.data;
    return data.events || ['Message'];
  } catch (error: any) {
    logger.warn('Failed to get webhook events, using default', { error: error.message });
    return ['Message'];
  }
}

/**
 * Get current webhook configuration
 * API: GET {WA_API_URL}/webhook
 */
export async function getWebhookConfig(villageId?: string): Promise<{ subscribe: string[]; webhook: string }> {
  try {
    const resolved = await resolveAccessToken(villageId).catch(() => null);
    if (!resolved) {
      return { subscribe: ['Message'], webhook: '' };
    }

    const url = `${config.WA_API_URL}/webhook`;
    
    const response = await axios.get(url, {
      headers: {
        token: resolved.token,
      },
      timeout: 10000,
    });

    const data = response.data.data || response.data;
    return {
      subscribe: data.subscribe || ['Message'],
      webhook: data.webhook || '',
    };
  } catch (error: any) {
    logger.warn('Failed to get webhook config', { error: error.message });
    return { subscribe: ['Message'], webhook: '' };
  }
}

function extractSessionToken(data: any): string | null {
  return (
    data?.token ||
    data?.Token ||
    data?.sessionToken ||
    data?.session?.token ||
    data?.data?.token ||
    data?.data?.Token ||
    data?.data?.sessionToken ||
    data?.data?.session?.token ||
    null
  );
}

export async function getStoredSession(villageId: string) {
  return getSessionByVillageId(villageId);
}

export async function createSessionForVillage(params: {
  villageId: string;
  adminId?: string;
  villageSlug?: string;
}) {
  const existing = await getSessionByVillageId(params.villageId);

  // Migration handling: if session exists but has no wa-support user,
  // it means the village migrated from old WA system. Clean up old session
  // and create a fresh one via wa-support-v2.
  if (existing && !existing.wa_support_user_id && waSupportClient.isConfigured()) {
    logger.info('Migration detected: existing session without wa-support user, recreating', {
      village_id: params.villageId,
    });

    // Try to logout old session gracefully
    try {
      await logoutSession(existing.wa_token);
    } catch (e: any) {
      logger.debug('Old session logout skipped', { error: e?.message });
    }

    // Delete old session row so we can create a new one
    await prisma.wa_sessions.delete({ where: { village_id: params.villageId } });
  } else if (existing) {
    return { existing: true };
  }

  const webhook = getPublicWhatsAppWebhookUrl();
  let token: string;
  let sessionId: string | null = null;
  let waSupportApiKey: string | undefined;

  if (waSupportClient.isConfigured()) {
    // Primary path: create session via wa-support-v2
    const user = await ensureWaSupportUser(params.villageId);
    waSupportApiKey = user.apiKey;

    const created = await createSessionViaWaSupport({
      apiKey: user.apiKey,
      villageId: params.villageId,
      villageSlug: params.villageSlug,
      webhook,
    });
    token = created.token;
    sessionId = created.sessionId;
  } else if (isDryRun()) {
    token = `dryrun_${params.villageId}_${Date.now()}`;
  } else {
    // Fallback: create directly on WA provider (legacy)
    const url = `${config.WA_API_URL}/session/create`;
    const response = await axios.post(url, { Name: params.villageId }, { timeout: 15000 });
    const data = response.data?.data || response.data;
    const extracted = extractSessionToken(data);
    if (!extracted) {
      throw new Error('Token sesi tidak ditemukan dari server WA');
    }
    token = extracted;
  }

  // Compute the instance_name (session name on WA provider)
  const instanceName = params.villageSlug || params.villageId.toLowerCase().replace(/[^a-z0-9-]/g, '-');

  await upsertSession({
    villageId: params.villageId,
    adminId: params.adminId,
    token,
    instanceName,
    waSupportUserId: params.villageId,
    waSupportApiKey: waSupportApiKey,
    waSupportSessionId: sessionId || undefined,
  });

  // Auto-read is already enabled via createSessionViaWaSupport (auto_read_enabled: true)
  // But also try enabling via WA provider for backward compat
  if (!waSupportClient.isConfigured()) {
    await enableAutoReadForSession(token).catch((err) => {
      logger.warn('Failed to enable auto_read for session', { 
        village_id: params.villageId, 
        error: err.message 
      });
    });
  }

  if (!webhook) {
    logger.warn('PUBLIC_CHANNEL_BASE_URL/PUBLIC_BASE_URL not set; webhook not configured during session creation', {
      village_id: params.villageId,
      via: waSupportClient.isConfigured() ? 'wa-support-v2' : 'wa-provider',
    });
  }

  return { existing: false, session_id: sessionId };
}

/**
 * Enable auto_read_enabled setting for a WA session via genfity-wa-support
 * Uses session token header for authentication (no admin token needed)
 */
async function enableAutoReadForSession(sessionToken: string) {
  const waApiUrl = (config.WA_API_URL || '').replace(/\/$/, '');
  if (!waApiUrl) {
    logger.warn('WA_API_URL not configured, skipping auto_read enable');
    return;
  }

  // genfity-wa-support endpoint: PUT /session/settings
  // Authenticated by session token in header
  const url = `${waApiUrl}/session/settings`;
  
  try {
    await axios.put(
      url,
      {
        auto_read_enabled: true,
        chat_log_enabled: true,
      },
      {
        headers: {
          'Content-Type': 'application/json',
          'token': sessionToken,
        },
        timeout: 10000,
      }
    );
    logger.info('Auto read enabled for session', { token: sessionToken.substring(0, 8) + '...' });
  } catch (error: any) {
    // Log but don't fail - this is not critical for session creation
    logger.warn('Failed to enable auto_read via genfity-wa-support', { 
      error: error.message,
      status: error.response?.status,
    });
  }
}

export async function updateStoredSessionStatus(params: {
  villageId: string;
  status?: string;
  waNumber?: string | null;
}) {
  return prisma.wa_sessions.update({
    where: { village_id: params.villageId },
    data: {
      status: params.status || null,
      wa_number: params.waNumber || null,
      last_connected_at: params.status === 'connected' ? new Date() : undefined,
    },
  });
}

export async function deleteSessionForVillage(villageId: string) {
  const session = await getSessionByVillageId(villageId);
  if (!session) return { deleted: false };

  try {
    await logoutSession(session.wa_token);
  } catch (error: any) {
    logger.warn('Logout session before delete failed', { error: error.message });
  }

  // Delete session from wa-support-v2 if configured
  if (waSupportClient.isConfigured() && session.wa_support_api_key && session.wa_support_session_id) {
    await deleteSessionFromWaSupport(session.wa_support_api_key, session.wa_support_session_id).catch((err) => {
      logger.warn('Failed to delete session from wa-support-v2', { 
        village_id: villageId, 
        error: err.message 
      });
    });
  }

  await prisma.wa_sessions.delete({
    where: { village_id: villageId },
  });

  await prisma.channel_accounts.updateMany({
    where: { village_id: villageId },
    data: {
      wa_number: '',
      enabled_wa: false,
    },
  });
  return { deleted: true };
}

/**
 * Connect WhatsApp session
 * API: POST {WA_API_URL}/session/connect
 * Body: { Subscribe: ["Message", "ReadReceipt"], Immediate: true }
 */
export async function connectSession(token: string): Promise<{ details: string }> {
  try {
    if (!token) {
      throw new Error('WhatsApp token not configured');
    }

    if (isDryRun()) {
      logger.info('WA_DRY_RUN: connectSession skipped');
      return { details: 'Connected (dry-run)' };
    }

    const url = `${config.WA_API_URL}/session/connect`;
    
    const response = await axios.post(url, {
      Subscribe: ['Message', 'ReadReceipt'],
      Immediate: true,
    }, {
      headers: {
        token,
        'Content-Type': 'application/json',
      },
      timeout: 30000,
    });

    const data = response.data.data || response.data;
    logger.info('WhatsApp session connected', { details: data });
    
    return {
      details: data.Details || data.details || 'Connected',
    };
  } catch (error: any) {
    // Handle "already connected" as success - session is connected, just not logged in yet
    const errorMsg = error.response?.data?.error || error.message || '';
    if (errorMsg === 'already connected' || errorMsg.includes('already connected')) {
      logger.info('WhatsApp session already connected', { details: errorMsg });
      return { details: 'Already connected' };
    }
    
    logger.error('Failed to connect session', {
      error: error.message,
      response: error.response?.data,
    });
    throw new Error(error.response?.data?.error || error.response?.data?.message || error.message);
  }
}

/**
 * Disconnect WhatsApp session (keeps session data)
 */
export async function disconnectSession(token: string): Promise<{ details: string }> {
  try {
    if (!token) {
      throw new Error('WhatsApp token not configured');
    }

    if (isDryRun()) {
      logger.info('WA_DRY_RUN: disconnectSession skipped');
      return { details: 'Disconnected (dry-run)' };
    }

    const url = `${config.WA_API_URL}/session/disconnect`;
    
    const response = await axios.post(url, {}, {
      headers: {
        token,
      },
      timeout: 10000,
    });

    const data = response.data.data || response.data;
    logger.info('WhatsApp session disconnected', { details: data });
    
    return {
      details: data.Details || 'Disconnected',
    };
  } catch (error: any) {
    logger.error('Failed to disconnect session', {
      error: error.message,
      response: error.response?.data,
    });
    throw new Error(error.response?.data?.message || error.message);
  }
}

/**
 * Logout WhatsApp session (clears session data, requires QR rescan)
 */
export async function logoutSession(token: string): Promise<{ details: string }> {
  try {
    if (!token) {
      throw new Error('WhatsApp token not configured');
    }

    if (isDryRun()) {
      logger.info('WA_DRY_RUN: logoutSession skipped');
      return { details: 'Logged out (dry-run)' };
    }

    const url = `${config.WA_API_URL}/session/logout`;
    
    const response = await axios.post(url, {}, {
      headers: {
        token,
      },
      timeout: 10000,
    });

    const data = response.data.data || response.data;
    logger.info('WhatsApp session logged out', { details: data });
    
    return {
      details: data.Details || 'Logged out',
    };
  } catch (error: any) {
    logger.error('Failed to logout session', {
      error: error.message,
      response: error.response?.data,
    });
    throw new Error(error.response?.data?.message || error.message);
  }
}

/**
 * Get QR Code for authentication
 * API: GET {WA_API_URL}/session/qr
 * Only works when session is connected but not logged in yet
 */
export async function getQRCode(token: string): Promise<{ QRCode: string; alreadyLoggedIn?: boolean }> {
  try {
    if (!token) {
      throw new Error('WhatsApp token not configured');
    }

    if (isDryRun()) {
      return { QRCode: 'dry-run-qr-not-available' };
    }

    const url = `${config.WA_API_URL}/session/qr`;
    
    const response = await axios.get(url, {
      headers: {
        token,
      },
      timeout: 10000,
    });

    const data = response.data.data || response.data;
    
    return {
      QRCode: data.QRCode || '',
    };
  } catch (error: any) {
    // Handle "already logged in" case - this is not an error
    if (error.response?.data?.error === 'already logged in') {
      return {
        QRCode: '',
        alreadyLoggedIn: true,
      };
    }
    
    // Handle "no session" case
    if (error.response?.data?.error === 'no session') {
      throw new Error('Session not connected. Please connect first.');
    }
    
    logger.error('Failed to get QR code', {
      error: error.message,
      response: error.response?.data,
    });
    throw new Error(error.response?.data?.error || error.response?.data?.message || error.message);
  }
}

/**
 * Pair phone for authentication
 */
export async function pairPhone(token: string, phone: string): Promise<{ LinkingCode: string }> {
  try {
    if (!token) {
      throw new Error('WhatsApp token not configured');
    }

    if (isDryRun()) {
      logger.info('WA_DRY_RUN: pairPhone skipped', { phone });
      return { LinkingCode: 'DRYRUN-CODE' };
    }

    const url = `${config.WA_API_URL}/session/pairphone`;
    
    const response = await axios.post(url, {
      Phone: phone,
    }, {
      headers: {
        token,
        'Content-Type': 'application/json',
      },
      timeout: 30000,
    });

    const data = response.data.data || response.data;
    logger.info('Phone pairing initiated', { phone });
    
    return {
      LinkingCode: data.LinkingCode || data.linkingCode || '',
    };
  } catch (error: any) {
    logger.error('Failed to pair phone', {
      error: error.message,
      response: error.response?.data,
    });
    throw new Error(error.response?.data?.message || error.message);
  }
}

// =====================================================
// SESSION SETTINGS FUNCTIONS
// =====================================================

interface SessionSettingsData {
  autoReadMessages: boolean;
  typingIndicator: boolean;
}

/**
 * Get session settings
 */
export async function getSessionSettings(): Promise<SessionSettingsData> {
  // Try to load from database if available
  try {
    const settings = await prisma.wa_settings.findFirst({
      where: { id: 'default' },
    });
    
    if (settings) {
      sessionSettings = {
        autoReadMessages: settings.auto_read_messages,
        typingIndicator: settings.typing_indicator,
      };
    }
  } catch (error) {
    // Table might not exist, use in-memory settings
    logger.debug('Using in-memory settings (database table may not exist)');
  }
  
  return sessionSettings;
}

/**
 * Update session settings
 */
export async function updateSessionSettings(
  updates: Partial<SessionSettingsData>
): Promise<SessionSettingsData> {
  // Update in-memory settings
  if (updates.autoReadMessages !== undefined) {
    sessionSettings.autoReadMessages = updates.autoReadMessages;
  }
  if (updates.typingIndicator !== undefined) {
    sessionSettings.typingIndicator = updates.typingIndicator;
  }
  
  // Try to persist to database
  try {
    await prisma.wa_settings.upsert({
      where: { id: 'default' },
      update: {
        auto_read_messages: sessionSettings.autoReadMessages,
        typing_indicator: sessionSettings.typingIndicator,
        updated_at: new Date(),
      },
      create: {
        id: 'default',
        auto_read_messages: sessionSettings.autoReadMessages,
        typing_indicator: sessionSettings.typingIndicator,
      },
    });
    logger.info('Session settings saved to database', sessionSettings);
  } catch (error) {
    // Table might not exist, settings will be in-memory only
    logger.warn('Failed to persist settings to database, using in-memory only');
  }
  
  return sessionSettings;
}

/**
 * Check if auto-read is enabled
 */
export function isAutoReadEnabled(): boolean {
  return sessionSettings.autoReadMessages;
}

/**
 * Check if typing indicator is enabled
 */
export function isTypingIndicatorEnabled(): boolean {
  return sessionSettings.typingIndicator;
}

/**
 * Send typing indicator (composing state)
 */
export async function sendTypingIndicator(
  phone: string,
  state: 'composing' | 'paused' = 'composing',
  villageId?: string
): Promise<boolean> {
  if (!sessionSettings.typingIndicator) {
    return false;
  }
  
  try {
    const resolved = await resolveAccessToken(villageId);
    const accessToken = resolved.token;
    if (!accessToken) return false;

    if ((process.env.WA_DRY_RUN || '').toLowerCase() === 'true') {
      logger.info('WA_DRY_RUN: Skipping typing indicator', {
        village_id: resolved.village_id,
        phone,
        state,
        token_source: resolved.source,
      });
      return true;
    }

    const url = `${config.WA_API_URL}/chat/presence`;
    
    await axios.post(url, {
      Phone: phone,
      State: state,
      Media: '',
    }, {
      headers: {
        token: accessToken,
        'Content-Type': 'application/json',
      },
      timeout: 5000,
    });

    return true;
  } catch (error: any) {
    logger.error('Failed to send typing indicator', {
      phone,
      state,
      error: error.message,
    });
    return false;
  }
}

/**
 * Mark messages as read
 * Note: Always reload settings from database to ensure we have the latest value
 */
export async function markMessageAsRead(
  messageIds: string[],
  chatPhone: string,
  senderPhone: string,
  villageId?: string
): Promise<boolean> {
  // Always reload settings from database to get latest value
  // This ensures setting changes from dashboard are reflected immediately
  try {
    const settings = await prisma.wa_settings.findFirst({
      where: { id: 'default' },
    });
    
    if (settings) {
      sessionSettings.autoReadMessages = settings.auto_read_messages;
    }
  } catch (error) {
    logger.debug('Could not reload settings, using cached value');
  }
  
  if (!sessionSettings.autoReadMessages) {
    logger.debug('Auto read is disabled, skipping mark as read', { 
      chatPhone, 
      messageCount: messageIds.length,
      autoReadEnabled: sessionSettings.autoReadMessages 
    });
    return false;
  }
  
  try {
    const resolved = await resolveAccessToken(villageId);
    const accessToken = resolved.token;
    if (!accessToken) return false;

    if ((process.env.WA_DRY_RUN || '').toLowerCase() === 'true') {
      logger.info('WA_DRY_RUN: Skipping mark-as-read', {
        village_id: resolved.village_id,
        chatPhone,
        messageCount: messageIds.length,
        token_source: resolved.source,
      });
      return true;
    }

    const url = `${config.WA_API_URL}/chat/markread`;
    
    await axios.post(url, {
      Id: messageIds,
      ChatPhone: chatPhone,
      SenderPhone: senderPhone,
    }, {
      headers: {
        token: accessToken,
        'Content-Type': 'application/json',
      },
      timeout: 5000,
    });

    logger.info('Messages marked as read', { messageIds, chatPhone, autoReadEnabled: true });
    return true;
  } catch (error: any) {
    logger.error('Failed to mark messages as read', {
      messageIds,
      chatPhone,
      error: error.message,
    });
    return false;
  }
}

// =====================================================
// MESSAGE SENDING FUNCTIONS
// =====================================================

/**
 * Send text message via clivy-wa-support/genfity-wa API
 * 
 * API Endpoint: POST {WA_API_URL}/chat/send/text
 * Headers: token: <session_token>
 * Body: { "Phone": "628xxx", "Body": "message text" }
 */
export async function sendTextMessage(
  to: string,
  message: string,
  villageId?: string
): Promise<{ success: boolean; message_id?: string; error?: string }> {
  try {
    const account = await getDefaultChannelAccount(villageId);
    if (account && account.enabled_wa === false) {
      logger.info('WhatsApp channel disabled, message not sent', { to });
      return {
        success: false,
        error: 'WhatsApp channel disabled',
      };
    }

    const resolved = await resolveAccessToken(villageId);
    const accessToken = resolved.token;
    if (!accessToken) {
      logger.warn('WhatsApp token not configured, message not sent');
      return {
        success: false,
        error: 'WhatsApp not configured',
      };
    }

    // Dry-run mode: do not hit external WA API. Useful for tenant isolation verification.
    if ((process.env.WA_DRY_RUN || '').toLowerCase() === 'true') {
      const normalizedPhone = normalizePhoneNumber(to);
      const fakeMessageId = `dryrun_${Date.now()}`;
      logger.info('WA_DRY_RUN: Skipping WhatsApp API call', {
        village_id: resolved.village_id,
        to: normalizedPhone,
        token_source: resolved.source,
        message_id: fakeMessageId,
      });
      return { success: true, message_id: fakeMessageId };
    }

    // Normalize phone number - remove any non-digit characters and ensure starts with country code
    const normalizedPhone = normalizePhoneNumber(to);

    const url = `${config.WA_API_URL}/chat/send/text`;

    logger.debug('Sending WhatsApp message', { url, to: normalizedPhone });

    const response = await axios.post(
      url,
      {
        Phone: normalizedPhone,
        Body: message,
      },
      {
        headers: {
          token: accessToken,
          'Content-Type': 'application/json',
        },
        timeout: 30000, // 30 seconds timeout
      }
    );

    // genfity-wa returns { code: 200, data: { Details: "Sent", Id: "msgid", Timestamp: "..." }, success: true }
    const responseData = response.data.data || response.data;
    const messageId = responseData.Id || responseData.id;
    const isSuccess = response.data.success === true || response.data.code === 200 || responseData.Details === 'Sent';

    if (!isSuccess) {
      logger.warn('WhatsApp API returned non-success response', { 
        to: normalizedPhone,
        response: response.data
      });
      return {
        success: false,
        error: responseData.Message || responseData.message || 'Unknown error from WhatsApp API',
      };
    }

    logger.info('WhatsApp message sent', { 
      to: normalizedPhone, 
      message_id: messageId,
      details: responseData.Details 
    });

    return {
      success: true,
      message_id: messageId,
    };
  } catch (error: any) {
    logger.error('Failed to send WhatsApp message', {
      to,
      error: error.message,
      response: error.response?.data,
      status: error.response?.status,
    });

    return {
      success: false,
      error: error.response?.data?.message || error.response?.data?.Message || error.message,
    };
  }
}

/**
 * Send contact/vCard message via genfity-wa API
 * 
 * API Endpoint: POST {WA_API_URL}/chat/send/contact
 * Headers: token: <session_token>
 * Body: { "Phone": "628xxx", "Name": "Contact Name", "Vcard": "BEGIN:VCARD\n..." }
 */
export async function sendContactMessage(
  to: string,
  contact: {
    name: string;
    phone: string;
    organization?: string;
    title?: string;
  },
  villageId?: string
): Promise<{ success: boolean; message_id?: string; error?: string }> {
  try {
    const account = await getDefaultChannelAccount(villageId);
    if (account && account.enabled_wa === false) {
      logger.info('WhatsApp channel disabled, contact not sent', { to });
      return {
        success: false,
        error: 'WhatsApp channel disabled',
      };
    }

    const resolved = await resolveAccessToken(villageId);
    const accessToken = resolved.token;
    if (!accessToken) {
      logger.warn('WhatsApp token not configured, contact not sent');
      return {
        success: false,
        error: 'WhatsApp not configured',
      };
    }

    // Normalize phone numbers
    const normalizedTo = normalizePhoneNumber(to);
    const normalizedContactPhone = normalizePhoneNumber(contact.phone);
    
    // Format contact phone for vCard (add + prefix for international format)
    const vcardPhone = normalizedContactPhone.startsWith('62') 
      ? `+${normalizedContactPhone}` 
      : normalizedContactPhone;

    // Build vCard string
    const vcard = buildVCard({
      name: contact.name,
      phone: vcardPhone,
      organization: contact.organization,
      title: contact.title,
    });

    // Dry-run mode
    if ((process.env.WA_DRY_RUN || '').toLowerCase() === 'true') {
      const fakeMessageId = `dryrun_contact_${Date.now()}`;
      logger.info('WA_DRY_RUN: Skipping WhatsApp contact send', {
        village_id: resolved.village_id,
        to: normalizedTo,
        contact_name: contact.name,
        message_id: fakeMessageId,
      });
      return { success: true, message_id: fakeMessageId };
    }

    const url = `${config.WA_API_URL}/chat/send/contact`;

    logger.debug('Sending WhatsApp contact', { url, to: normalizedTo, contact_name: contact.name });

    const response = await axios.post(
      url,
      {
        Phone: normalizedTo,
        Name: contact.name,
        Vcard: vcard,
      },
      {
        headers: {
          token: accessToken,
          'Content-Type': 'application/json',
        },
        timeout: 30000,
      }
    );

    const responseData = response.data.data || response.data;
    const messageId = responseData.Id || responseData.id;
    const isSuccess = response.data.success === true || response.data.code === 200 || responseData.Details === 'Sent';

    if (!isSuccess) {
      logger.warn('WhatsApp API returned non-success for contact', { 
        to: normalizedTo,
        contact_name: contact.name,
        response: response.data
      });
      return {
        success: false,
        error: responseData.Message || responseData.message || 'Unknown error from WhatsApp API',
      };
    }

    logger.info('WhatsApp contact sent', { 
      to: normalizedTo, 
      contact_name: contact.name,
      message_id: messageId,
    });

    return {
      success: true,
      message_id: messageId,
    };
  } catch (error: any) {
    logger.error('Failed to send WhatsApp contact', {
      to,
      contact_name: contact.name,
      error: error.message,
      response: error.response?.data,
    });

    return {
      success: false,
      error: error.response?.data?.message || error.response?.data?.Message || error.message,
    };
  }
}

/**
 * Build vCard string for WhatsApp contact
 */
function buildVCard(contact: {
  name: string;
  phone: string;
  organization?: string;
  title?: string;
}): string {
  const nameParts = contact.name.split(' ');
  const lastName = nameParts.length > 1 ? nameParts[0] : '';
  const firstName = nameParts.length > 1 ? nameParts.slice(1).join(' ') : contact.name;
  
  const lines = [
    'BEGIN:VCARD',
    'VERSION:3.0',
    `N:${lastName};${firstName};;;`,
    `FN:${contact.name}`,
  ];
  
  if (contact.organization) {
    lines.push(`ORG:${contact.organization};`);
  }
  
  if (contact.title) {
    lines.push(`TITLE:${contact.title}`);
  }
  
  lines.push(`TEL;type=CELL;type=pref:${contact.phone}`);
  lines.push('END:VCARD');
  
  return lines.join('\n');
}

/**
 * Normalize phone number to standard format
 * - Remove non-digit characters
 * - Ensure starts with country code (62 for Indonesia)
 * - Remove @s.whatsapp.net suffix if present
 */
function normalizePhoneNumber(phone: string): string {
  // Remove @s.whatsapp.net suffix
  let normalized = phone.replace(/@s\.whatsapp\.net$/i, '');
  
  // Remove all non-digit characters
  normalized = normalized.replace(/\D/g, '');
  
  // If starts with 0, replace with 62 (Indonesia country code)
  if (normalized.startsWith('0')) {
    normalized = '62' + normalized.substring(1);
  }
  
  // If doesn't start with country code, add 62
  if (!normalized.startsWith('62') && !normalized.startsWith('+')) {
    normalized = '62' + normalized;
  }
  
  return normalized;
}

/**
 * Validate webhook signature (optional, for production)
 */
export function validateWebhookSignature(
  _signature: string,
  _body: string,
  _secret: string
): boolean {
  // TODO: Implement HMAC signature verification
  // For now, return true (skip verification in development)
  return true;
}
