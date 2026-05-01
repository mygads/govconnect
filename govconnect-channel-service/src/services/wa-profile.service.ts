import prisma from '../config/database';
import logger from '../utils/logger';
import { getStoredSession, waGatewayRequest } from './wa.service';
import { logWaActivity } from './wa-activity-log.service';

function toWaJid(phone: string) {
  const normalized = phone.replace(/\D/g, '');
  return normalized.includes('@') ? normalized : `${normalized}@s.whatsapp.net`;
}

function normalizePhone(phone: string) {
  let normalized = phone.replace(/@s\.whatsapp\.net$/i, '').replace(/\D/g, '');
  if (normalized.startsWith('0')) normalized = `62${normalized.slice(1)}`;
  if (normalized && !normalized.startsWith('62')) normalized = `62${normalized}`;
  return normalized;
}

export interface WaUserProfile {
  profileName: string | null;
  avatarUrl: string | null;
  isWhatsApp: boolean | null;
  raw: Record<string, unknown>;
}

function firstPayloadItem(value: any): any {
  if (!value) return null;
  if (Array.isArray(value)) return value[0] || null;
  if (Array.isArray(value.data)) return value.data[0] || null;
  if (Array.isArray(value.Data)) return value.Data[0] || null;
  if (Array.isArray(value.results)) return value.results[0] || null;
  if (Array.isArray(value.Results)) return value.Results[0] || null;
  if (value.data && typeof value.data === 'object') return firstPayloadItem(value.data) || value.data;
  if (value.Data && typeof value.Data === 'object') return firstPayloadItem(value.Data) || value.Data;
  return value;
}

function firstString(...values: any[]): string | null {
  const found = values.find(value => typeof value === 'string' && value.trim());
  return found ? found.trim() : null;
}

function firstBoolean(...values: any[]): boolean | null {
  const found = values.find(value => typeof value === 'boolean');
  return typeof found === 'boolean' ? found : null;
}

export async function getWaUserProfile(villageId: string, phone: string): Promise<WaUserProfile> {
  const session = await getStoredSession(villageId);
  if (!session) throw new Error('WhatsApp session not found');

  const normalizedPhone = normalizePhone(phone);
  const jid = toWaJid(normalizedPhone);

  const [checkResult, infoResult, avatarResult] = await Promise.all([
    waGatewayRequest(session.wa_token, '/user/check', 'POST', { Phone: [normalizedPhone] }).catch(() => null),
    waGatewayRequest(session.wa_token, '/user/info', 'POST', { Phone: [jid] }).catch(() => null),
    waGatewayRequest(session.wa_token, '/user/avatar', 'POST', { Phone: jid, Preview: true }).catch(() => null),
  ]);

  const infoItem = firstPayloadItem(infoResult);
  const checkItem = firstPayloadItem(checkResult);
  const avatarItem = firstPayloadItem(avatarResult);
  const avatarUrl = firstString(
    avatarResult?.url,
    avatarResult?.URL,
    avatarResult?.picture,
    avatarResult?.Picture,
    avatarResult?.avatar,
    avatarResult?.Avatar,
    avatarItem?.url,
    avatarItem?.URL,
    avatarItem?.picture,
    avatarItem?.Picture,
    avatarItem?.avatar,
    avatarItem?.Avatar,
  );
  const profileName = firstString(
    infoItem?.PushName,
    infoItem?.pushName,
    infoItem?.Name,
    infoItem?.name,
    infoItem?.VerifiedName,
    infoItem?.verifiedName,
    infoItem?.Notify,
    infoItem?.notify,
    checkItem?.PushName,
    checkItem?.pushName,
    checkItem?.Name,
    checkItem?.name,
  );
  const isWhatsApp = firstBoolean(
    checkItem?.exists,
    checkItem?.Exists,
    checkItem?.IsInWhatsapp,
    checkItem?.isInWhatsapp,
    checkItem?.IsWhatsApp,
    checkItem?.isWhatsApp,
    checkItem?.is_whatsapp,
  );

  return {
    profileName,
    avatarUrl,
    isWhatsApp,
    raw: {
      check: checkResult,
      info: infoResult,
      avatar: avatarResult,
    },
  };
}

export async function enrichConversationProfile(villageId: string, phone: string, pushName?: string) {
  const normalizedPhone = normalizePhone(phone);

  try {
    const profile = await getWaUserProfile(villageId, normalizedPhone);
    await prisma.conversation.updateMany({
      where: {
        village_id: villageId,
        channel: 'WHATSAPP',
        channel_identifier: normalizedPhone,
      },
      data: {
        user_name: pushName || profile.profileName || undefined,
        profile_name: profile.profileName,
        profile_avatar_url: profile.avatarUrl,
        profile_is_whatsapp: profile.isWhatsApp,
        profile_raw: profile.raw as any,
        profile_synced_at: new Date(),
      },
    });

    await logWaActivity({
      villageId,
      waUserId: normalizedPhone,
      channelIdentifier: normalizedPhone,
      type: 'profile_sync',
      severity: 'info',
      status: 'synced',
      message: 'Profil WhatsApp pengguna berhasil disinkronkan.',
      metadata: { profileName: profile.profileName, hasAvatar: !!profile.avatarUrl, isWhatsApp: profile.isWhatsApp },
    });
  } catch (error: any) {
    logger.warn('Failed to enrich conversation profile', {
      village_id: villageId,
      phone: normalizedPhone,
      error: error.message,
    });

    await logWaActivity({
      villageId,
      waUserId: normalizedPhone,
      channelIdentifier: normalizedPhone,
      type: 'profile_sync',
      severity: 'warning',
      status: 'failed',
      message: 'Gagal menyinkronkan profil WhatsApp pengguna.',
      metadata: { error: error.message },
    });
  }
}
