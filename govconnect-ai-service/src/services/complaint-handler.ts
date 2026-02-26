/**
 * Complaint Handler — handles complaint creation, updates, address confirmation,
 * and builds complaint category text for LLM prompts.
 */

import logger from '../utils/logger';
import axios from 'axios';
import { config } from '../config/env';
import {
  createComplaint,
  cancelComplaint,
  updateComplaintByUser,
  getUserHistory,
} from './case-client.service';
import { getImportantContacts } from './important-contacts.service';
import { rateLimiterService } from './rate-limiter.service';
import { aiAnalyticsService } from './ai-analytics.service';
import { classifyConfirmation } from './confirmation-classifier.service';
import { analyzeAddress, classifyUpdateIntent } from './micro-llm-matcher.service';
import { saveDefaultAddress, getProfile, recordServiceUsage } from './user-profile.service';
import { recordCompletedAction, recordDataCollected } from './conversation-context.service';
import type { ChannelType, HandlerResult, ContactInfo } from './ump-formatters';
import {
  buildChannelParams,
  buildImportantContactsMessage,
  buildCancelSuccessResponse,
  buildCancelErrorResponse,
  buildHistoryResponse,
  toVCardContacts,
} from './ump-formatters';
import {
  pendingAddressConfirmation,
  pendingAddressRequest,
  pendingComplaintData,
  addPendingPhoto,
  consumePendingPhotos,
  getPendingPhotoCount,
  MAX_PHOTOS_PER_COMPLAINT,
  setPendingCancelConfirmation,
} from './ump-state';
import {
  isVagueAddress,
  extractAddressFromMessage,
  resolveComplaintTypeConfig,
  getCachedComplaintTypes,
} from './ump-utils';

// ==================== COMPLAINT CATEGORIES TEXT ====================

/**
 * Build complaint categories text for injection into LLM prompt.
 * Fetches dynamic categories from Case Service DB and formats them
 * so the LLM knows which kategori values are valid.
 */
export async function buildComplaintCategoriesText(villageId?: string): Promise<string> {
  try {
    const types = await getCachedComplaintTypes(villageId);
    if (!types || types.length === 0) {
      logger.warn('No complaint types from DB, using generic fallback');
      return 'lainnya (kategori pengaduan akan disesuaikan oleh sistem berdasarkan deskripsi)';
    }

    // Group by category
    const categoryMap = new Map<string, string[]>();
    for (const type of types) {
      const catName = type?.category?.name || 'Lainnya';
      if (!categoryMap.has(catName)) {
        categoryMap.set(catName, []);
      }
      const typeName = type?.name || '';
      if (typeName) {
        categoryMap.get(catName)!.push(typeName);
      }
    }

    // Format: "Kategori: tipe1, tipe2, tipe3"
    const lines: string[] = [];
    for (const [category, typeNames] of categoryMap) {
      const snakeCaseNames = typeNames.map(n => n.toLowerCase().replace(/\s+/g, '_'));
      lines.push(`- ${category}: ${snakeCaseNames.join(', ')}`);
    }
    lines.push('- lainnya (gunakan jika tidak ada kategori yang cocok)');

    return lines.join('\n');
  } catch (error: any) {
    logger.warn('Failed to build complaint categories text', { error: error.message });
    return 'lainnya (kategori pengaduan akan disesuaikan oleh sistem berdasarkan deskripsi)';
  }
}

// ==================== COMPLAINT CREATION ====================

/**
 * Handle complaint creation
 */
export async function handleComplaintCreation(
  userId: string,
  channel: ChannelType,
  llmResponse: any,
  currentMessage: string,
  mediaUrl?: string
): Promise<HandlerResult> {
  const { kategori, rt_rw } = llmResponse.fields || {};
  let { alamat, deskripsi } = llmResponse.fields || {};
  const villageId = llmResponse.fields?.village_id;
  const complaintTypeConfig = await resolveComplaintTypeConfig(kategori, villageId);
  const requireAddress = complaintTypeConfig?.require_address ?? false;

  logger.info('LLM complaint fields', {
    userId,
    kategori,
    alamat,
    deskripsi,
    rt_rw,
    hasMedia: !!mediaUrl,
    currentMessage: currentMessage.substring(0, 100),
  });

  // SMART ALAMAT DETECTION: If LLM didn't extract alamat, try NLU-based extraction
  if (!alamat) {
    alamat = await extractAddressFromMessage(currentMessage, userId, { village_id: villageId, channel, kategori });
  }

  // Fallback: if deskripsi is empty but we have kategori, generate default description
  if (!deskripsi && kategori) {
    deskripsi = complaintTypeConfig?.name
      ? `Laporan ${complaintTypeConfig.name}`
      : `Laporan ${String(kategori).replace(/_/g, ' ')}`;
  }

  // Ensure deskripsi is at least 10 characters (Case Service requirement)
  if (deskripsi && deskripsi.length < 10) {
    const kategoriLabel = String(kategori || 'masalah').replace(/_/g, ' ');
    if (alamat) {
      deskripsi = `Laporan ${kategoriLabel} di ${alamat}`;
    } else {
      deskripsi = `Laporan ${kategoriLabel} - ${deskripsi}`;
    }
    logger.info('Description enriched to meet minimum length', {
      userId,
      originalLength: (llmResponse.fields?.deskripsi || '').length,
      newLength: deskripsi.length,
      deskripsi,
    });
  }

  // Check if we have enough information
  if (!kategori || (requireAddress && !alamat)) {
    logger.info('Incomplete complaint data, asking for more info', {
      userId,
      hasKategori: !!kategori,
      hasAlamat: !!alamat,
      hasDeskripsi: !!deskripsi,
      requireAddress,
    });

    if (!kategori) {
      return 'Mohon jelaskan jenis masalah yang ingin dilaporkan agar kami bisa membantu menindaklanjuti.';
    }
    if (!alamat) {
      // Store pending address request so we can continue when user provides address
      if (mediaUrl) addPendingPhoto(userId, mediaUrl);
      pendingAddressRequest.set(userId, {
        kategori,
        deskripsi: deskripsi || `Laporan ${kategori.replace(/_/g, ' ')}`,
        village_id: villageId,
        timestamp: Date.now(),
        foto_url: undefined,
      });

      const kategoriLabel = complaintTypeConfig?.name?.toLowerCase()
        || kategori.replace(/_/g, ' ');
      const isEmergencyNeedAddress = typeof complaintTypeConfig?.is_urgent === 'boolean'
        ? complaintTypeConfig.is_urgent : false;

      logger.info('Storing pending address request', { userId, kategori, deskripsi });

      if (isEmergencyNeedAddress) {
        return 'Baik Pak/Bu, mohon segera kirimkan alamat lokasi kejadian.';
      }
      return `Baik Pak/Bu, mohon jelaskan lokasi ${kategoriLabel} tersebut.`;
    }

    return llmResponse.reply_text;
  }

  // Check if alamat is too vague - ask for confirmation
  if (alamat && await isVagueAddress(alamat, { village_id: villageId, wa_user_id: userId, session_id: userId, channel, kategori })) {
    logger.info('Address is vague, asking for confirmation', { userId, alamat, kategori });

    if (mediaUrl) addPendingPhoto(userId, mediaUrl);
    pendingAddressConfirmation.set(userId, {
      alamat,
      kategori,
      deskripsi: deskripsi || `Laporan ${kategori.replace(/_/g, ' ')}`,
      village_id: villageId,
      timestamp: Date.now(),
      foto_url: undefined,
    });

    const kategoriLabel = kategori.replace(/_/g, ' ');
    const pendingPhotoCount = getPendingPhotoCount(userId);
    const photoNote = pendingPhotoCount > 0 ? `\n\n${pendingPhotoCount} foto sudah kami terima.` : '';
    return `Alamat "${alamat}" sepertinya kurang spesifik untuk laporan ${kategoriLabel}.${photoNote}\n\nApakah Bapak/Ibu ingin menambahkan detail alamat (nomor rumah, RT/RW, nama jalan lengkap) atau balas "YA" untuk tetap menggunakan alamat ini?`;
  }

  // Emergency detection is fully DB-driven via complaintTypeConfig.is_urgent
  const isEmergency = typeof complaintTypeConfig?.is_urgent === 'boolean'
    ? complaintTypeConfig.is_urgent : false;

  // ==================== NAME & PHONE VALIDATION ====================
  const isWebchatChannel = channel === 'webchat';
  const userProfile = getProfile(userId);
  const hasName = !!userProfile.nama_lengkap;
  const hasPhone = !!userProfile.no_hp;

  const needsName = !hasName;
  const needsPhone = isWebchatChannel && !hasPhone;

  if (needsName || needsPhone) {
    if (mediaUrl) addPendingPhoto(userId, mediaUrl);
    pendingComplaintData.set(userId, {
      kategori,
      deskripsi: deskripsi || `Laporan ${kategori.replace(/_/g, ' ')}`,
      alamat: alamat || undefined,
      rt_rw: rt_rw || '',
      village_id: villageId,
      foto_url: undefined,
      channel,
      timestamp: Date.now(),
      waitingFor: needsName ? 'nama' : 'no_hp',
    });

    logger.info('Storing pending complaint, waiting for user info', {
      userId, channel, needsName, needsPhone, kategori,
    });

    const pendingPhotoCount = getPendingPhotoCount(userId);
    const photoNote = pendingPhotoCount > 0 ? `\n${pendingPhotoCount} foto sudah kami terima.` : '';

    if (needsName) {
      return `Baik Pak/Bu, sebelum laporan diproses, boleh kami tahu nama Bapak/Ibu?${photoNote}`;
    }
    return `Baik Pak/Bu, mohon informasikan nomor telepon yang dapat dihubungi agar petugas bisa menghubungi Bapak/Ibu terkait laporan ini.${photoNote}`;
  }

  // ==================== CREATE COMPLAINT ====================
  const combinedFotoUrl = consumePendingPhotos(userId, mediaUrl);

  const complaintId = await createComplaint({
    wa_user_id: isWebchatChannel ? undefined : userId,
    channel: isWebchatChannel ? 'WEBCHAT' : 'WHATSAPP',
    channel_identifier: userId,
    kategori,
    deskripsi: deskripsi || `Laporan ${kategori.replace(/_/g, ' ')}`,
    village_id: villageId,
    alamat: alamat || undefined,
    rt_rw: rt_rw || '',
    foto_url: combinedFotoUrl,
    category_id: complaintTypeConfig?.category_id,
    type_id: complaintTypeConfig?.id,
    is_urgent: isEmergency,
    require_address: requireAddress,
    reporter_name: userProfile.nama_lengkap,
    reporter_phone: isWebchatChannel ? userProfile.no_hp : userId,
  });

  if (complaintId) {
    rateLimiterService.recordReport(userId);
    aiAnalyticsService.recordSuccess('CREATE_COMPLAINT');
    saveDefaultAddress(userId, alamat, rt_rw);
    recordServiceUsage(userId, kategori);
    recordCompletedAction(userId, 'CREATE_COMPLAINT', complaintId);
    recordDataCollected(userId, 'kategori', kategori);
    if (alamat) {
      recordDataCollected(userId, 'alamat', alamat);
    }

    const hasRtRw = Boolean(rt_rw) || /\brt\b|\brw\b/i.test(alamat || '');
    const photoCount = combinedFotoUrl ? (combinedFotoUrl.startsWith('[') ? JSON.parse(combinedFotoUrl).length : 1) : 0;
    const withPhotoNote = photoCount > 0 ? `\n${photoCount > 1 ? photoCount + ' foto' : 'Foto'} pendukung sudah kami terima.` : '';

    // ==================== IMPORTANT CONTACTS ====================
    let importantContactsMessage = '';
    let vcardContacts: ContactInfo[] = [];

    if (complaintTypeConfig?.send_important_contacts && complaintTypeConfig?.important_contact_category) {
      const contacts = await getImportantContacts(
        villageId,
        complaintTypeConfig.important_contact_category,
        undefined
      );
      importantContactsMessage = buildImportantContactsMessage(contacts, channel);
      vcardContacts = toVCardContacts(contacts);
    } else if (isEmergency) {
      // Dynamic emergency contact resolution:
      // Instead of a hardcoded kategori→category map, try the kategori label
      // as a contact category name directly (case-insensitive match in Dashboard DB),
      // then fall back to 'Darurat', then fall back to all contacts.
      const kategoriLabel = String(kategori || '').replace(/_/g, ' ');
      logger.info('Emergency complaint: searching contacts dynamically', { kategori, kategoriLabel });

      // Step 1: Try matching by kategori label (e.g., 'banjir' → contact category 'Banjir' or 'Bencana')
      let contacts = await getImportantContacts(villageId, kategoriLabel, undefined);

      // Step 2: Fallback — try 'Darurat' category
      if (!contacts || contacts.length === 0) {
        contacts = await getImportantContacts(villageId, 'Darurat', undefined);
      }

      // Step 3: Fallback — try 'Bencana' category (common in village setups)
      if (!contacts || contacts.length === 0) {
        contacts = await getImportantContacts(villageId, 'Bencana', undefined);
      }

      // Step 4: Last resort — get ALL contacts
      if (!contacts || contacts.length === 0) {
        contacts = await getImportantContacts(villageId, undefined, undefined);
      }

      importantContactsMessage = buildImportantContactsMessage(contacts, channel);
      vcardContacts = toVCardContacts(contacts);

      logger.info('Emergency complaint: contacts resolved', {
        userId, kategori, hasContacts: contacts.length > 0,
      });
    }

    if (isEmergency) {
      logger.info('Emergency complaint detected', { userId, complaintId, kategori, deskripsi });
    }

    const statusLine = isEmergency || hasRtRw ? '\nStatus laporan saat ini: OPEN.' : '';
    const photoReminder = photoCount === 0
      ? '\n\n📷 Tip: Bapak/Ibu bisa kirim foto pendukung untuk mempercepat penanganan. Cukup kirim foto kapan saja.'
      : '';
    const multiComplaintHint = '\n\nJika ada laporan lain, silakan langsung sampaikan.';
    const replyText = `Terima kasih.\nLaporan telah kami terima dengan nomor ${complaintId}.${statusLine}${withPhotoNote}${photoReminder}${importantContactsMessage}${multiComplaintHint}`;
    
    // Return structured result with vCard contacts if available
    if (vcardContacts.length > 0) {
      return { replyText, contacts: vcardContacts };
    }
    return replyText;
  }

  aiAnalyticsService.recordFailure('CREATE_COMPLAINT');
  throw new Error('Failed to create complaint in Case Service');
}

// ==================== COMPLAINT UPDATE ====================

/**
 * Handle complaint update by user
 */
export async function handleComplaintUpdate(userId: string, channel: ChannelType, llmResponse: any, currentMessage: string = ''): Promise<string> {
  const { complaint_id, alamat, deskripsi, rt_rw } = llmResponse.fields || {};

  if (!complaint_id) {
    return llmResponse.reply_text || 'Mohon sebutkan nomor laporan yang ingin diperbarui (contoh: LAP-20251201-001).';
  }

  // Use NLU to classify update intent instead of regex
  let wantsPhoto = false;
  try {
    const updateIntent = await classifyUpdateIntent(currentMessage || '', {
      village_id: undefined, wa_user_id: userId, session_id: userId, channel,
    });
    if (updateIntent && updateIntent.intent === 'send_photo' && updateIntent.confidence >= 0.6) {
      wantsPhoto = true;
    }
  } catch {
    // NLU failed, proceed without photo detection
  }
  if (wantsPhoto) {
    return 'Baik, silakan kirimkan foto pendukung laporan tersebut.';
  }

  if (!alamat && !deskripsi && !rt_rw) {
    return 'Baik, silakan sampaikan keterangan tambahan yang ingin ditambahkan.';
  }

  let mergedDeskripsi = deskripsi;
  if (deskripsi) {
    mergedDeskripsi = `[Update] ${deskripsi}`;
  }

  const result = await updateComplaintByUser(complaint_id, buildChannelParams(channel, userId), { alamat, deskripsi: mergedDeskripsi, rt_rw });

  if (!result.success) {
    if (result.error === 'NOT_FOUND') {
      return `Hmm, laporan *${complaint_id}* tidak ditemukan. Coba cek kembali nomor laporan ya.`;
    }
    if (result.error === 'NOT_OWNER') {
      return `Mohon maaf Pak/Bu, laporan *${complaint_id}* bukan milik Anda, jadi tidak bisa diubah.`;
    }
    if (result.error === 'LOCKED') {
      return `Laporan *${complaint_id}* sudah selesai/dibatalkan/ditolak sehingga tidak bisa diubah.`;
    }
    return result.message || 'Maaf, terjadi kendala saat memperbarui laporan.';
  }

  return `Terima kasih.\nKeterangan laporan ${complaint_id} telah diperbarui.`;
}

// ==================== CANCELLATION ====================

export async function handleCancellationRequest(
  userId: string,
  type: 'laporan' | 'layanan',
  llmResponse: any
): Promise<string> {
  const { complaint_id, request_number, cancel_reason } = llmResponse.fields || {};
  const targetId = type === 'laporan' ? complaint_id : request_number;

  if (!targetId) {
    if (llmResponse.reply_text) return llmResponse.reply_text;
    return type === 'laporan'
      ? 'Untuk membatalkan laporan, mohon sertakan nomornya ya Pak/Bu (contoh: LAP-20251201-001).'
      : 'Untuk membatalkan layanan, mohon sertakan nomornya ya Pak/Bu (contoh: LAY-20251201-001).';
  }

  setPendingCancelConfirmation(userId, {
    type,
    id: targetId,
    reason: cancel_reason,
    timestamp: Date.now(),
  });

  const label = type === 'laporan' ? 'laporan' : 'layanan';
  return `Apakah Bapak/Ibu yakin ingin membatalkan ${label} ${targetId}?\nBalas YA untuk konfirmasi.`;
}

// ==================== HISTORY ====================

/**
 * Handle user history request
 */
export async function handleHistory(userId: string, channel: ChannelType): Promise<string> {
  logger.info('Handling history request', { userId });

  const history = await getUserHistory(buildChannelParams(channel, userId));

  if (!history || history.total === 0) {
    return 'Belum ada laporan atau layanan. Silakan kirim pesan untuk memulai.';
  }

  return buildHistoryResponse(history.combined, history.total);
}

// ==================== ADDRESS CONFIRMATION ====================

/**
 * Handle pending address confirmation
 */
export async function handlePendingAddressConfirmation(
  userId: string,
  message: string,
  pendingConfirm: { alamat: string; kategori: string; deskripsi: string; village_id?: string; timestamp: number; foto_url?: string },
  channel: 'whatsapp' | 'webchat',
  mediaUrl?: string
): Promise<string | null> {
  // Use micro LLM for confirmation classification
  let addrDecision: string;
  try {
    const addrResult = await classifyConfirmation(message.trim(), { village_id: pendingConfirm.village_id, wa_user_id: userId, session_id: userId, channel });
    addrDecision = addrResult?.decision === 'CONFIRM' ? 'yes' : addrResult?.decision === 'REJECT' ? 'no' : 'uncertain';
  } catch {
    addrDecision = 'uncertain';
  }

  if (addrDecision === 'yes') {
    logger.info('User confirmed vague address, creating complaint', { userId, alamat: pendingConfirm.alamat });

    pendingAddressConfirmation.delete(userId);
    if (mediaUrl) addPendingPhoto(userId, mediaUrl);
    const combinedFotoUrl = consumePendingPhotos(userId);

    const complaintTypeConfig = await resolveComplaintTypeConfig(pendingConfirm.kategori, pendingConfirm.village_id);
    const isEmergency = typeof complaintTypeConfig?.is_urgent === 'boolean' ? complaintTypeConfig.is_urgent : false;
    const userProfile = getProfile(userId);

    const complaintId = await createComplaint({
      wa_user_id: channel === 'webchat' ? undefined : userId,
      channel: channel === 'webchat' ? 'WEBCHAT' : 'WHATSAPP',
      channel_identifier: userId,
      kategori: pendingConfirm.kategori,
      deskripsi: pendingConfirm.deskripsi,
      village_id: pendingConfirm.village_id,
      alamat: pendingConfirm.alamat,
      rt_rw: '',
      foto_url: combinedFotoUrl,
      category_id: complaintTypeConfig?.category_id,
      type_id: complaintTypeConfig?.id,
      is_urgent: isEmergency,
      reporter_name: userProfile.nama_lengkap,
      reporter_phone: channel === 'webchat' ? userProfile.no_hp : userId,
    });

    if (!complaintId) {
      throw new Error('Failed to create complaint after address confirmation');
    }

    rateLimiterService.recordReport(userId);
    aiAnalyticsService.recordSuccess('CREATE_COMPLAINT');
    saveDefaultAddress(userId, pendingConfirm.alamat, '');
    recordServiceUsage(userId, pendingConfirm.kategori);
    recordCompletedAction(userId, 'CREATE_COMPLAINT', complaintId);

    const photoCount = combinedFotoUrl ? (combinedFotoUrl.startsWith('[') ? JSON.parse(combinedFotoUrl).length : 1) : 0;
    const withPhotoNote = photoCount > 0 ? `\n${photoCount > 1 ? photoCount + ' foto' : 'Foto'} pendukung sudah kami terima.` : '';
    return `Terima kasih.\nLaporan telah kami terima dengan nomor ${complaintId}.${withPhotoNote}`;
  }

  if (addrDecision === 'no') {
    logger.info('User rejected vague address, asking for specific address', { userId });
    pendingAddressConfirmation.delete(userId);
    return 'Baik Pak/Bu, silakan berikan alamat yang lebih spesifik (contoh: Jl. Merdeka No. 5 RT 02/RW 03), atau ketik "batal" jika ingin membatalkan laporan.';
  }

  // Check if user provides more specific address via NLU
  const addressCheck = await analyzeAddress(message, {
    village_id: pendingConfirm.village_id, wa_user_id: userId, session_id: userId, channel, kategori: pendingConfirm.kategori,
  });
  const looksLikeAddress = addressCheck && addressCheck.has_address && addressCheck.quality === 'specific';

  if (looksLikeAddress) {
    logger.info('User provided more specific address', { userId, newAlamat: message });

    pendingAddressConfirmation.delete(userId);
    if (mediaUrl) addPendingPhoto(userId, mediaUrl);
    const combinedFotoUrl = consumePendingPhotos(userId);

    const typeConfig = await resolveComplaintTypeConfig(pendingConfirm.kategori, pendingConfirm.village_id);
    const isUrgent = typeof typeConfig?.is_urgent === 'boolean' ? typeConfig.is_urgent : false;
    const profile = getProfile(userId);

    const complaintId = await createComplaint({
      wa_user_id: channel === 'webchat' ? undefined : userId,
      channel: channel === 'webchat' ? 'WEBCHAT' : 'WHATSAPP',
      channel_identifier: userId,
      kategori: pendingConfirm.kategori,
      deskripsi: pendingConfirm.deskripsi,
      village_id: pendingConfirm.village_id,
      alamat: message.trim(),
      rt_rw: '',
      foto_url: combinedFotoUrl,
      category_id: typeConfig?.category_id,
      type_id: typeConfig?.id,
      is_urgent: isUrgent,
      reporter_name: profile.nama_lengkap,
      reporter_phone: channel === 'webchat' ? profile.no_hp : userId,
    });

    if (!complaintId) {
      throw new Error('Failed to create complaint with updated address');
    }

    rateLimiterService.recordReport(userId);
    aiAnalyticsService.recordSuccess('CREATE_COMPLAINT');
    saveDefaultAddress(userId, message.trim(), '');
    recordServiceUsage(userId, pendingConfirm.kategori);
    recordCompletedAction(userId, 'CREATE_COMPLAINT', complaintId);

    const photoCount2 = combinedFotoUrl ? (combinedFotoUrl.startsWith('[') ? JSON.parse(combinedFotoUrl).length : 1) : 0;
    const withPhotoNote = photoCount2 > 0 ? `\n${photoCount2 > 1 ? photoCount2 + ' foto' : 'Foto'} pendukung sudah kami terima.` : '';
    return `Terima kasih.\nLaporan telah kami terima dengan nomor ${complaintId}.${withPhotoNote}`;
  }

  // User said something else, clear pending and continue normal flow
  logger.info('User response not confirmation, clearing pending and processing normally', { userId });
  pendingAddressConfirmation.delete(userId);
  return null;
}
