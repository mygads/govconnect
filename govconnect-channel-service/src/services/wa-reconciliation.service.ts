import prisma from '../config/database';
import logger from '../utils/logger';
import {
  REQUIRED_WEBHOOK_EVENTS,
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
  subscribedEvents: string[];
  missingEvents: string[];
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
      subscribedEvents: [],
      missingEvents: REQUIRED_WEBHOOK_EVENTS,
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
  const extraEvents = subscribedEvents.filter(event => !REQUIRED_WEBHOOK_EVENTS.includes(event));
  const webhookUrl = webhookConfig.webhook || '';
  const webhookMatches = !!expectedWebhookUrl && normalizeWebhookUrl(webhookUrl) === normalizeWebhookUrl(expectedWebhookUrl);
  const waNumber = extractWaNumber(providerStatus.jid) || session.wa_number || null;

  if (!expectedWebhookUrl) issues.push({ severity: 'error', code: 'public_webhook_missing', message: 'PUBLIC_CHANNEL_BASE_URL/PUBLIC_BASE_URL belum dikonfigurasi.' });
  if (!webhookUrl) issues.push({ severity: 'error', code: 'webhook_missing', message: 'Webhook belum terpasang di provider WhatsApp.' });
  if (webhookUrl && !webhookMatches) issues.push({ severity: 'warning', code: 'webhook_mismatch', message: 'Webhook provider tidak sama dengan URL publik GovConnect.' });
  if (missingEvents.length > 0) issues.push({ severity: 'warning', code: 'missing_events', message: `Event webhook belum lengkap: ${missingEvents.join(', ')}` });
  if (!session.webhook_secret) issues.push({ severity: 'warning', code: 'hmac_missing', message: 'Webhook secret belum tersimpan di GovConnect.' });
  if (!providerStatus.connected) issues.push({ severity: 'warning', code: 'provider_disconnected', message: 'Provider melaporkan session belum connected.' });
  if (providerStatus.connected && !providerStatus.loggedIn) issues.push({ severity: 'warning', code: 'provider_not_logged_in', message: 'Provider connected tetapi WhatsApp belum login.' });

  return {
    villageId,
    instanceName: session.instance_name,
    sessionId: session.wa_support_session_id,
    providerActiveEvents,
    requiredEvents: REQUIRED_WEBHOOK_EVENTS,
    subscribedEvents,
    missingEvents,
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
  const dbStatus = status.connected ? 'connected' : 'disconnected';

  await updateStoredSessionStatus({ villageId, status: dbStatus, waNumber });
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
    severity: status.connected ? 'info' : 'warning',
    status: dbStatus,
    message: status.connected ? 'Session WhatsApp tersinkron dengan provider.' : 'Provider melaporkan session WhatsApp disconnected.',
    metadata: { providerStatus: status, waNumber },
  });

  return { ...status, waNumber, dbStatus };
}

export async function syncWhatsAppWebhook(villageId: string): Promise<WhatsAppSessionAudit> {
  const session = await getStoredSession(villageId);
  if (!session) throw new Error('WhatsApp session not found');

  const expectedWebhookUrl = getPublicWhatsAppWebhookUrl();
  if (!expectedWebhookUrl) throw new Error('PUBLIC_CHANNEL_BASE_URL/PUBLIC_BASE_URL not configured');

  const before = await auditWhatsAppSession(villageId);
  const needsWebhookRepair = !before.webhookMatches || before.missingEvents.length > 0;

  if (needsWebhookRepair) {
    await waGatewayRequest(session.wa_token, '/webhook', 'PUT', {
      webhook: expectedWebhookUrl,
      events: REQUIRED_WEBHOOK_EVENTS,
      active: true,
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
    metadata: { issues: after.issues, missingEvents: after.missingEvents },
  });

  return after;
}
