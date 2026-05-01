import { GenfityWebhookPayload } from '../types/webhook.types';

function firstString(...values: unknown[]): string {
  for (const value of values) {
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return '';
}

export function parseWebhookBody(body: any): { payload: GenfityWebhookPayload | null; parseError?: unknown } {
  if (typeof body?.jsonData !== 'string') {
    return { payload: body || {} };
  }

  try {
    return { payload: JSON.parse(body.jsonData) };
  } catch (parseError) {
    return { payload: null, parseError };
  }
}

export function webhookCandidateFromBody(body: any): string {
  const direct = firstString(body?.instanceName, body?.userID, body?.userId, body?.session_id, body?.sessionId);
  if (direct) return direct;

  const { payload } = parseWebhookBody(body);
  if (!payload) return '';

  const event = (payload as any).event;
  const data = (payload as any).data;

  const info = event?.Info || event?.info;

  return firstString(
    payload.instanceName,
    payload.userID,
    (payload as any).userId,
    (payload as any).session_id,
    (payload as any).sessionId,
    event?.instanceName,
    event?.userID,
    event?.userId,
    event?.session_id,
    event?.sessionId,
    event?.JID,
    event?.Jid,
    event?.jid,
    info?.InstanceName,
    info?.instanceName,
    info?.UserID,
    info?.userID,
    info?.Sender,
    info?.SenderAlt,
    info?.Chat,
    data?.instanceName,
    data?.userID,
    data?.userId,
    data?.session_id,
    data?.sessionId,
    data?.jid,
    data?.JID
  );
}
