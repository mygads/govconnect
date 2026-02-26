/**
 * Status Handler — handles complaint & service request status checks.
 */

import logger from '../utils/logger';
import {
  getComplaintStatusWithOwnership,
  getServiceRequestStatusWithOwnership,
  getServiceRequirements,
  ServiceRequirementDefinition,
} from './case-client.service';
import type { ChannelType } from './ump-formatters';
import {
  buildChannelParams,
  getStatusInfo,
  buildNaturalStatusResponse,
  buildNaturalServiceStatusResponse,
  buildComplaintDetailResponse,
  buildServiceRequestDetailResponse,
} from './ump-formatters';
import { getEnhancedContext } from './conversation-context.service';

/**
 * Handle status check for complaints and service requests.
 * Includes ownership validation — user can only check their own records.
 */
export async function handleStatusCheck(
  userId: string,
  channel: ChannelType,
  llmResponse: any,
  currentMessage: string = '',
): Promise<string> {
  const { complaint_id, request_number } = llmResponse.fields;
  const detailMode = !!(llmResponse.fields?.detail_mode || llmResponse.fields?.detail);

  if (!complaint_id && !request_number) {
    if (llmResponse.reply_text) return llmResponse.reply_text;
    const ctx = getEnhancedContext(userId);
    const lastComplaint = ctx.keyPoints
      .slice()
      .reverse()
      .find((point: string) => /CREATE_COMPLAINT berhasil:/i.test(point));
    const inferredComplaintId = lastComplaint?.split('berhasil:')[1]?.trim();
    if (inferredComplaintId) {
      llmResponse.fields.complaint_id = inferredComplaintId;
    } else {
      return 'Untuk cek status, mohon sebutkan nomor laporan atau layanan ya Pak/Bu (contoh: LAP-20251201-001 atau LAY-20251201-001).';
    }
  }

  if (complaint_id || llmResponse.fields.complaint_id) {
    const cId = complaint_id || llmResponse.fields.complaint_id;
    const result = await getComplaintStatusWithOwnership(cId, buildChannelParams(channel, userId));

    if (!result.success) {
      if (result.error === 'NOT_FOUND') {
        return `Mohon maaf Pak/Bu, kami tidak menemukan laporan dengan nomor *${cId}*.\n\nSilakan cek ulang format nomor laporan (contoh: LAP-20251201-001).`;
      }
      if (result.error === 'NOT_OWNER') {
        return `Mohon maaf Pak/Bu, laporan *${cId}* bukan milik Anda.\n\nSilakan cek kembali nomor laporan Anda. Jika lupa, ketik "riwayat" untuk melihat daftar laporan Anda.`;
      }
      return 'Mohon maaf Pak/Bu, ada kendala saat mengecek status. Silakan coba lagi.';
    }

    if (!result.data) {
      return 'Mohon maaf Pak/Bu, ada kendala saat menampilkan detail laporan. Silakan coba lagi.';
    }

    if (!detailMode) {
      const isExplicitCheck = /(cek|status|cek\s+laporan|cek\s+lagi)/i.test(currentMessage || '');
      const statusInfo = getStatusInfo(result.data.status);
      if (!isExplicitCheck && statusInfo.key === 'PROCESS') {
        return `Mohon maaf Pak/Bu, laporan ${cId} masih *Sedang Diproses* oleh petugas desa.`;
      }
      if (!isExplicitCheck && statusInfo.key === 'OPEN') {
        return `Mohon maaf Pak/Bu, laporan ${cId} masih *Menunggu Diproses* oleh petugas desa.`;
      }
    }
    return detailMode ? buildComplaintDetailResponse(result.data) : buildNaturalStatusResponse(result.data);
  }

  if (request_number) {
    const result = await getServiceRequestStatusWithOwnership(request_number, buildChannelParams(channel, userId));

    if (!result.success) {
      if (result.error === 'NOT_FOUND') {
        return `Mohon maaf Pak/Bu, kami tidak menemukan permohonan layanan dengan nomor *${request_number}*.\n\nSilakan cek ulang format nomor layanan (contoh: LAY-20251201-001).`;
      }
      if (result.error === 'NOT_OWNER') {
        return `Mohon maaf Pak/Bu, permohonan layanan *${request_number}* bukan milik Anda.\n\nSilakan cek kembali nomor layanan Anda. Jika lupa, ketik "riwayat" untuk melihat daftar layanan Anda.`;
      }
      return 'Mohon maaf Pak/Bu, ada kendala saat mengecek status layanan. Silakan coba lagi.';
    }

    if (!result.data) {
      return 'Mohon maaf Pak/Bu, ada kendala saat menampilkan detail layanan. Silakan coba lagi.';
    }

    if (!detailMode) return buildNaturalServiceStatusResponse(result.data);

    let requirementDefs: ServiceRequirementDefinition[] = [];
    const serviceId: string | undefined = result.data?.service_id || result.data?.serviceId;
    if (serviceId) {
      requirementDefs = await getServiceRequirements(String(serviceId));
    }

    return buildServiceRequestDetailResponse(result.data, requirementDefs);
  }

  return 'Mohon maaf Pak/Bu, ada kendala saat mengecek status. Silakan coba lagi.';
}
