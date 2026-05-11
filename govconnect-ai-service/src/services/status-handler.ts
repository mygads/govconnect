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
import { rememberMemoryEvent } from './hybrid-memory.service';

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
      const rawError = String(result.error || '').toUpperCase();
      const rawMessage = String(result.message || '').toUpperCase();
      const isNotFound = rawError.includes('NOT_FOUND') || rawError.includes('NOTFOUND') || rawMessage.includes('NOT FOUND') || rawMessage.includes('TIDAK DITEMUKAN');
      const isNotOwner = rawError.includes('NOT_OWNER') || rawError.includes('FORBIDDEN') || rawMessage.includes('BUKAN MILIK') || rawMessage.includes('TIDAK TERDAFTAR ATAS NOMOR');

      if (isNotFound) {
        return `Nomor laporan *${cId}* tidak kami temukan.\n\nCoba cek lagi penulisannya ya. Formatnya biasanya seperti *LAP-20251201-001*. Kalau mau, kirim nomor yang benar dan saya bantu cek lagi.`;
      }
      if (isNotOwner) {
        return `Laporan *${cId}* tidak terdaftar atas nomor Anda, jadi belum bisa saya tampilkan di sini.\n\nKalau lupa nomornya, ketik *riwayat* ya, nanti saya bantu tampilkan daftar laporan milik Anda.`;
      }
      return `Nomor laporan *${cId}* tidak kami temukan.\n\nCoba cek lagi penulisannya ya. Formatnya biasanya seperti *LAP-20251201-001*. Kalau mau, kirim nomor yang benar dan saya bantu cek lagi.`;
    }

    if (!result.data) {
      return 'Mohon maaf Pak/Bu, ada kendala saat menampilkan detail laporan. Silakan coba lagi.';
    }

    void rememberMemoryEvent({
      wa_user_id: userId,
      memory_type: 'status_lookup',
      memory_key: cId,
      importance: 0.68,
      content: `Status laporan ${cId} terakhir adalah ${result.data.status}.`,
      metadata_json: {
        reference_number: cId,
        status: result.data.status,
      },
    });

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
        return `Nomor layanan *${request_number}* belum kami temukan.\n\nCoba cek lagi penulisannya ya. Formatnya biasanya seperti *LAY-20251201-001*. Kalau mau, kirim lagi nomornya dan saya bantu cek.`;
      }
      if (result.error === 'NOT_OWNER') {
        return `Permohonan layanan *${request_number}* tidak terdaftar atas nomor Anda, jadi belum bisa saya tampilkan di sini.\n\nKalau lupa nomornya, ketik *riwayat* ya, nanti saya bantu tampilkan daftar layanan milik Anda.`;
      }
      return 'Mohon maaf Pak/Bu, ada kendala saat mengecek status layanan. Silakan coba lagi.';
    }

    if (!result.data) {
      return 'Mohon maaf Pak/Bu, ada kendala saat menampilkan detail layanan. Silakan coba lagi.';
    }

    void rememberMemoryEvent({
      wa_user_id: userId,
      memory_type: 'status_lookup',
      memory_key: request_number,
      importance: 0.68,
      content: `Status layanan ${request_number} terakhir adalah ${result.data.status}.`,
      metadata_json: {
        reference_number: request_number,
        status: result.data.status,
      },
    });

    if (!detailMode) return buildNaturalServiceStatusResponse(result.data);

    let requirementDefs: ServiceRequirementDefinition[] = [];
    const serviceId: string | undefined = result.data?.service_id || result.data?.serviceId;
    const villageId: string | undefined = result.data?.village_id || result.data?.villageId || result.data?.service?.village_id || result.data?.service?.villageId;
    if (serviceId) {
      requirementDefs = await getServiceRequirements(String(serviceId), villageId);
    }

    return buildServiceRequestDetailResponse(result.data, requirementDefs);
  }

  return 'Mohon maaf Pak/Bu, ada kendala saat mengecek status. Silakan coba lagi.';
}
