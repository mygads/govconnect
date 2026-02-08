import prisma from '../config/database';
import logger from '../utils/logger';
import { ChannelType, Prisma } from '@prisma/client';

export interface HistoryItem {
  type: 'complaint' | 'service';
  id: string;
  display_id: string;
  description: string;
  status: string;
  created_at: Date;
  updated_at: Date;
}

export interface UserHistoryResult {
  complaints: any[];
  services: any[];
  combined: HistoryItem[];
  total: number;
}

export async function getUserHistory(params: {
  wa_user_id?: string;
  channel?: ChannelType | 'WHATSAPP' | 'WEBCHAT';
  channel_identifier?: string;
}): Promise<UserHistoryResult> {
  const normalizedChannel = (params.channel || ChannelType.WHATSAPP).toString().toUpperCase();
  const channel = normalizedChannel === 'WEBCHAT'
    ? ChannelType.WEBCHAT
    : ChannelType.WHATSAPP;
  const complaintIdentity: Prisma.ComplaintWhereInput = channel === ChannelType.WEBCHAT
    ? { channel: ChannelType.WEBCHAT, channel_identifier: params.channel_identifier ?? undefined }
    : { wa_user_id: params.wa_user_id ?? undefined };
  const serviceIdentity: Prisma.ServiceRequestWhereInput = channel === ChannelType.WEBCHAT
    ? { channel: ChannelType.WEBCHAT, channel_identifier: params.channel_identifier ?? undefined }
    : { wa_user_id: params.wa_user_id ?? undefined };

  try {
    const [complaints, services] = await Promise.all([
      prisma.complaint.findMany({
        where: complaintIdentity,
        orderBy: { created_at: 'desc' },
        take: 30,
        select: {
          id: true,
          complaint_id: true,
          kategori: true,
          deskripsi: true,
          status: true,
          created_at: true,
          updated_at: true,
        },
      }),
      prisma.serviceRequest.findMany({
        where: serviceIdentity,
        orderBy: { created_at: 'desc' },
        take: 30,
        select: {
          id: true,
          request_number: true,
          status: true,
          created_at: true,
          updated_at: true,
          service: {
            select: {
              name: true,
            },
          },
        },
      }),
    ]);

    const combined: HistoryItem[] = [
      ...complaints.map((c) => ({
        type: 'complaint' as const,
        id: c.id,
        display_id: c.complaint_id,
        description: c.deskripsi || getKategoriLabel(c.kategori),
        status: c.status,
        created_at: c.created_at,
        updated_at: c.updated_at,
      })),
      ...services.map((s) => ({
        type: 'service' as const,
        id: s.id,
        display_id: s.request_number,
        description: s.service?.name || 'Layanan',
        status: s.status,
        created_at: s.created_at,
        updated_at: s.updated_at,
      })),
    ].sort((a, b) => b.created_at.getTime() - a.created_at.getTime());

    logger.info('User history fetched', {
      wa_user_id: params.wa_user_id,
      channel,
      channel_identifier: params.channel_identifier,
      complaints: complaints.length,
      services: services.length,
    });

    return {
      complaints,
      services,
      combined,
      total: complaints.length + services.length,
    };
  } catch (error: any) {
    logger.error('Failed to fetch user history', {
      wa_user_id: params.wa_user_id,
      channel,
      channel_identifier: params.channel_identifier,
      error: error.message,
    });
    throw error;
  }
}

function getKategoriLabel(kategori: string): string {
  // Dynamic: convert snake_case to Title Case (e.g. "jalan_rusak" -> "Jalan Rusak")
  if (!kategori) return 'Lainnya';
  return kategori
    .split('_')
    .map(word => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}
