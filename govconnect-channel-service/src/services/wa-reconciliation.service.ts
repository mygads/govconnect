import prisma from '../config/database';
import logger from '../utils/logger';
import {
  deriveWhatsAppLifecycleState,
  REQUIRED_WEBHOOK_EVENTS,
  RECOMMENDED_WEBHOOK_EVENTS,
  GOVCONNECT_WEBHOOK_EVENTS,
  getPublicWhatsAppWebhookUrl,
  getSessionStatus,
  getStoredSession,
  getWebhookConfig,
  getWebhookEvents,
  updateStoredSessionStatus,
  waGatewayRequest,
} from './wa.service';
import { logWaActivity } from './wa-activity-log.service';

export type ReconciliationSeverity = 'info' | 'warning' | 'error';

export interface WhatsAppAuditIssue {
  severity: ReconciliationSeverity;
  code: string;
  message: string;
}

export interface WhatsAppSessionAudit {
  villageId: string;
  instanceName: string | null;
  sessionId: string | null;
  providerActiveEvents: string[];
  requiredEvents: string[];
  recommendedEvents: string[];
  subscribedEvents: string[];
  missingEvents: string[];
  missingRecommendedEvents: string[];
  extraEvents: string[];
  webhookUrl: string;
  expectedWebhookUrl: string;
  webhookMatches: boolean;
  hmacConfigured: boolean;
  hmacRequired: boolean;
  dbStatus: string | null;
  providerStatus: {
    connected: boolean;
    loggedIn: boolean;
    jid?: string;
    name?: string;
  } | null;
  waNumber: string | null;
  issues: WhatsAppAuditIssue[];
  checkedAt: string;
}

function normalizeEventList(events: unknown): string[] {
  if (Array.isArray(events)) return events.map(String).filter(Boolean);
  if (typeof events === 'string') return events.split(',').map(event => event.trim()).filter(Boolean);
  return [];
}

function normalizeWebhookUrl(url: string) {
  return url.replace(/\/+$/, '');
}

function extractWaNumber(jid?: string | null) {
  if (!jid) return null;
  return jid.replace(/@s\.whatsapp\.net$/i, '').replace(/:\d+$/, '') || null;
}

export async function auditWhatsAppSession(villageId: string): Promise<WhatsAppSessionAudit> {
  const session = await getStoredSession(villageId);
  const expectedWebhookUrl = getPublicWhatsAppWebhookUrl();
  const issues: WhatsAppAuditIssue[] = [];

  if (!session) {
    issues.push({ severity: 'error', code: 'session_missing', message: 'Session WhatsApp belum dibuat untuk desa ini.' });
    return {
      villageId,
      instanceName: null,
      sessionId: null,
      providerActiveEvents: [],
      requiredEvents: REQUIRED_WEBHOOK_EVENTS,
      recommendedEvents: RECOMMENDED_WEBHOOK_EVENTS,
      subscribedEvents: [],
      missingEvents: REQUIRED_WEBHOOK_EVENTS,
      missingRecommendedEvents: RECOMMENDED_WEBHOOK_EVENTS,
      extraEvents: [],
      webhookUrl: '',
      expectedWebhookUrl,
      webhookMatches: false,
      hmacConfigured: false,
      hmacRequired: String(process.env.WEBHOOK_HMAC_REQUIRED || '').toLowerCase() === 'true',
      dbStatus: null,
      providerStatus: null,
      waNumber: null,
      issues,
      checkedAt: new Date().toISOString(),
    };
  }

  const [providerActiveEvents, webhookConfig, providerStatus] = await Promise.all([
    getWebhookEvents(villageId),
    getWebhookConfig(villageId),
    getSessionStatus(session.wa_token),
  ]);

  const subscribedEvents = normalizeEventList(webhookConfig.subscribe);
  const missingEvents = REQUIRED_WEBHOOK_EVENTS.filter(event => !subscribedEvents.includes(event));
  const missingRecommendedEvents = RECOMMENDED_WEBHOOK_EVENTS.filter(event => !subscribedEvents.includes(event));
  const expectedEvents = GOVCONNECT_WEBHOOK_EVENTS;
  const extraEvents = subscribedEvents.filter(event => !expectedEvents.includes(event) && event !== 'All');
  const webhookUrl = webhookConfig.webhook || '';
  const webhookMatches = !!expectedWebhookUrl && normalizeWebhookUrl(webhookUrl) === normalizeWebhookUrl(expectedWebhookUrl);
  const waNumber = extractWaNumber(providerStatus.jid) || session.wa_number || null;

  if (!expectedWebhookUrl) issues.push({ severity: 'error', code: 'public_webhook_missing', message: 'PUBLIC_CHANNEL_BASE_URL/PUBLIC_BASE_URL belum dikonfigurasi.' });
  if (!webhookUrl) issues.push({ severity: 'error', code: 'webhook_missing', message: 'Webhook belum terpasang di provider WhatsApp.' });
  if (webhookUrl && !webhookMatches) issues.push({ severity: 'warning', code: 'webhook_mismatch', message: 'Webhook provider tidak sama dengan URL publik GovConnect.' });
  if (missingEvents.length > 0) issues.push({ severity: 'error', code: 'missing_required_events', message: `Event webhook wajib belum lengkap: ${missingEvents.join(', ')}` });
  if (missingRecommendedEvents.length > 0) issues.push({ severity: 'warning', code: 'missing_recommended_events', message: `Event webhook rekomendasi belum lengkap: ${missingRecommendedEvents.join(', ')}` });
  if (subscribedEvents.includes('All')) issues.push({ severity: 'warning', code: 'all_event_enabled', message: 'Event All aktif dan bisa membuat volume webhook terlalu noisy di produksi.' });
  if (!session.webhook_secret) issues.push({ severity: 'warning', code: 'hmac_missing', message: 'Webhook secret belum tersimpan di GovConnect.' });
  if (providerStatus.statusFetchOk === false) issues.push({ severity: 'warning', code: 'provider_status_unavailable', message: 'Status provider WhatsApp belum bisa diambil.' });
  else if (!providerStatus.connected && providerStatus.loggedIn) issues.push({ severity: 'warning', code: 'provider_offline_auth_valid', message: 'Session WhatsApp masih login tetapi transport sedang disconnected.' });
  else if (!providerStatus.connected) issues.push({ severity: 'warning', code: 'provider_disconnected', message: 'Provider melaporkan session belum connected.' });
  if (providerStatus.connected && !providerStatus.loggedIn) issues.push({ severity: 'warning', code: 'provider_not_logged_in', message: 'Provider connected tetapi WhatsApp belum login.' });

  return {
    villageId,
    instanceName: session.instance_name,
    sessionId: session.wa_support_session_id,
    providerActiveEvents,
    requiredEvents: REQUIRED_WEBHOOK_EVENTS,
    recommendedEvents: RECOMMENDED_WEBHOOK_EVENTS,
    subscribedEvents,
    missingEvents,
    missingRecommendedEvents,
    extraEvents,
    webhookUrl,
    expectedWebhookUrl,
    webhookMatches,
    hmacConfigured: !!session.webhook_secret,
    hmacRequired: String(process.env.WEBHOOK_HMAC_REQUIRED || '').toLowerCase() === 'true',
    dbStatus: session.status,
    providerStatus,
    waNumber,
    issues,
    checkedAt: new Date().toISOString(),
  };
}

export async function syncWhatsAppSessionState(villageId: string) {
  const session = await getStoredSession(villageId);
  if (!session) throw new Error('WhatsApp session not found');

  const status = await getSessionStatus(session.wa_token);
  const waNumber = extractWaNumber(status.jid) || session.wa_number || null;
  const lifecycle = deriveWhatsAppLifecycleState({ dbStatus: session.status, providerStatus: status });
  const dbStatus = lifecycle.status;

  if (lifecycle.status_fetch_ok && dbStatus) {
    await updateStoredSessionStatus({ villageId, status: dbStatus, waNumber });
  } else if (waNumber) {
    await updateStoredSessionStatus({ villageId, waNumber });
  }
  if (waNumber) {
    await prisma.channel_accounts.updateMany({
      where: { village_id: villageId },
      data: { wa_number: waNumber },
    });
  }

  await logWaActivity({
    villageId,
    sessionId: session.wa_support_session_id,
    type: 'session_sync',
    severity: !lifecycle.status_fetch_ok ? 'warning' : status.connected ? 'info' : 'warning',
    status: dbStatus || session.status || 'unknown',
    message: !lifecycle.status_fetch_ok
      ? 'Status provider WhatsApp tidak dapat diambil saat sinkronisasi.'
      : status.connected
        ? 'Session WhatsApp tersinkron dengan provider.'
        : 'Provider melaporkan session WhatsApp disconnected.',
    metadata: { providerStatus: status, waNumber, lifecycle },
  });

  return { ...status, waNumber, dbStatus, ...lifecycle };
}


export async function reconcileWhatsAppSessionsBatch(limit = 10) {
  const sessions = await prisma.wa_sessions.findMany({
    select: {
      village_id: true,
      status: true,
      updated_at: true,
    },
    orderBy: { updated_at: 'asc' },
    take: limit,
  });

  const results = [];
  for (const session of sessions) {
    try {
      const result = await syncWhatsAppSessionState(session.village_id);
      results.push({ villageId: session.village_id, success: true, status: result.dbStatus });
    } catch (error: any) {
      logger.warn('WhatsApp reconciliation failed for session', {
        villageId: session.village_id,
        error: error.message,
      });
      results.push({ villageId: session.village_id, success: false, error: error.message });
    }
  }

  return {
    checked: results.length,
    failed: results.filter(result => !result.success).length,
    results,
  };
}

export async function syncWhatsAppWebhook(villageId: string): Promise<WhatsAppSessionAudit> {
  const session = await getStoredSession(villageId);
  if (!session) throw new Error('WhatsApp session not found');

  const expectedWebhookUrl = getPublicWhatsAppWebhookUrl();
  if (!expectedWebhookUrl) throw new Error('PUBLIC_CHANNEL_BASE_URL/PUBLIC_BASE_URL not configured');

  const before = await auditWhatsAppSession(villageId);
  const hasAllEvent = before.subscribedEvents.includes('All');
  const needsWebhookRepair = !before.webhookMatches || before.missingEvents.length > 0 || before.missingRecommendedEvents.length > 0 || hasAllEvent;

  if (needsWebhookRepair) {
    await waGatewayRequest(session.wa_token, '/webhook', 'PUT', {
      WebhookURL: expectedWebhookUrl,
      Events: GOVCONNECT_WEBHOOK_EVENTS,
      Active: true,
    });
    await logWaActivity({
      villageId,
      sessionId: session.wa_support_session_id,
      type: 'webhook_sync',
      severity: 'info',
      status: 'repaired',
      message: 'Webhook provider disinkronkan dengan konfigurasi GovConnect.',
      metadata: {
        expectedWebhookUrl,
        previousWebhookUrl: before.webhookUrl,
        missingEvents: before.missingEvents,
        missingRecommendedEvents: before.missingRecommendedEvents,
        removedAllEvent: hasAllEvent,
      },
    });
  }

  if (session.webhook_secret) {
    await waGatewayRequest(session.wa_token, '/session/hmac/config', 'POST', {
      hmac_key: session.webhook_secret,
    }).catch(async (error: any) => {
      logger.warn('Failed to sync WhatsApp HMAC config', { villageId, error: error.message });
      await logWaActivity({
        villageId,
        sessionId: session.wa_support_session_id,
        type: 'hmac_sync',
        severity: 'warning',
        status: 'failed',
        message: 'Gagal menyinkronkan HMAC session WhatsApp.',
        metadata: { error: error.message },
      });
    });
  }

  await syncWhatsAppSessionState(villageId);
  const after = await auditWhatsAppSession(villageId);

  await logWaActivity({
    villageId,
    sessionId: session.wa_support_session_id,
    type: 'webhook_audit',
    severity: after.issues.some(issue => issue.severity === 'error') ? 'error' : after.issues.some(issue => issue.severity === 'warning') ? 'warning' : 'info',
    status: after.issues.length === 0 ? 'ok' : 'issues_found',
    message: after.issues.length === 0 ? 'Audit webhook/session WhatsApp tidak menemukan masalah.' : `Audit webhook/session menemukan ${after.issues.length} issue.`,
    metadata: { issues: after.issues, missingEvents: after.missingEvents, missingRecommendedEvents: after.missingRecommendedEvents },
  });

  return after;
}
