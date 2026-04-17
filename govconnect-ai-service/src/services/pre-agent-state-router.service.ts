import {
  cancelComplaint,
  cancelServiceRequest,
} from './case-client.service';
import { updateConversationUserProfile } from './channel-client.service';
import { rememberMemoryEvent } from './hybrid-memory.service';
import { handleComplaintCreation, handlePendingAddressConfirmation } from './complaint-handler';
import { classifyConfirmation } from './confirmation-classifier.service';
import {
  analyzeAddress,
  UnifiedClassifyResult,
} from './micro-llm-matcher.service';
import { handleServiceRequestCreation } from './service-handler';
import { handleStatusCheck } from './status-handler';
import {
  buildCancelErrorResponse,
  buildCancelSuccessResponse,
  buildChannelParams,
} from './ump-formatters';
import { ProcessMessageResult, normalizeHandlerResult } from './ump-types';
import {
  MAX_PHOTOS_PER_COMPLAINT,
  addPendingPhoto,
  clearPendingAddressRequest,
  clearPendingCancelConfirmation,
  clearPendingComplaintData,
  clearPendingEmergencyComplaintOffer,
  clearPendingServiceFormOffer,
  getPendingAddressConfirmationWithFallback,
  getPendingAddressRequestWithFallback,
  getPendingCancelConfirmationWithFallback,
  getPendingComplaintDataWithFallback,
  getPendingEmergencyComplaintOfferWithFallback,
  getPendingPhotoCount,
  getPendingServiceFormOfferWithFallback,
  setPendingComplaintData,
  syncNameToChannelService,
} from './ump-state';
import {
  appendToHistoryCache,
  extractAddressFromMessage,
  extractNameFromTextNLU,
} from './ump-utils';
import { getAutoFillSuggestionsWithFallback, updateProfile } from './user-profile.service';

type MicroBudgetRunner = <T>(task: () => Promise<T>, fallback: T) => Promise<T>;
type TrackerLike = {
  preparing(): void;
  complete(): void;
};

function buildGuardResult(input: {
  startTime: number;
  traceId: string;
  response: string;
  intent: string;
  hasKnowledge?: boolean;
  contacts?: ProcessMessageResult['contacts'];
}): ProcessMessageResult {
  return {
    success: true,
    response: input.response,
    contacts: input.contacts,
    intent: input.intent,
    metadata: {
      processingTimeMs: Date.now() - input.startTime,
      hasKnowledge: input.hasKnowledge ?? false,
      agentMode: 'pre_agent_guard',
      traceId: input.traceId,
    },
  };
}

function toConfirmationDecision(result: { decision?: string } | null | undefined): 'yes' | 'no' | 'uncertain' {
  if (result?.decision === 'CONFIRM') return 'yes';
  if (result?.decision === 'REJECT') return 'no';
  return 'uncertain';
}

interface ProtocolGuardInput {
  userId: string;
  mediaType?: string;
  traceId: string;
  startTime: number;
}

export function tryHandleProtocolGuards(
  input: ProtocolGuardInput,
): ProcessMessageResult | null {
  const mediaType = input.mediaType?.toLowerCase();
  if (!mediaType || !['voice', 'audio', 'sticker', 'gif', 'video_note'].includes(mediaType)) {
    return null;
  }

  const mediaLabels: Record<string, string> = {
    voice: 'pesan suara',
    audio: 'audio',
    sticker: 'sticker',
    gif: 'GIF',
    video_note: 'video',
  };
  const label = mediaLabels[mediaType] || mediaType;

  return buildGuardResult({
    startTime: input.startTime,
    traceId: input.traceId,
    response: `Mohon maaf, saat ini kami belum bisa memproses ${label}. Silakan ketik pesan dalam bentuk teks ya, Pak/Bu.\n\nKetik *bantuan* untuk melihat daftar layanan yang tersedia.`,
    intent: 'QUESTION',
  });
}

interface PendingOfferInput {
  userId: string;
  message: string;
  channel: 'whatsapp' | 'webchat';
  villageId?: string;
  traceId: string;
  startTime: number;
  runWithMicroBudget: MicroBudgetRunner;
}

export async function tryHandlePendingOffers(
  input: PendingOfferInput,
): Promise<ProcessMessageResult | null> {
  const {
    userId,
    message,
    channel,
    villageId,
    traceId,
    startTime,
    runWithMicroBudget,
  } = input;

  const pendingOffer = await getPendingServiceFormOfferWithFallback(userId);
  if (pendingOffer) {
    const hasLapLayCode = /\b(LAP|LAY)-\d{8}-\d{3}\b/i.test(message);
    if (hasLapLayCode) {
      clearPendingServiceFormOffer(userId);
    } else {
      const confirmationResult = await runWithMicroBudget(
        () => classifyConfirmation(message.trim(), {
          village_id: villageId,
          wa_user_id: userId,
          session_id: userId,
          channel,
        }),
        null,
      );
      const decision = toConfirmationDecision(confirmationResult);

      if (decision === 'yes') {
        clearPendingServiceFormOffer(userId);
        const linkReply = await handleServiceRequestCreation(userId, channel, {
          intent: 'CREATE_SERVICE_REQUEST',
          fields: {
            service_slug: pendingOffer.service_slug,
            ...(pendingOffer.village_id ? { village_id: pendingOffer.village_id } : {}),
          },
          reply_text: '',
        });
        return buildGuardResult({
          startTime,
          traceId,
          response: linkReply,
          intent: 'CREATE_SERVICE_REQUEST',
        });
      }

      if (decision === 'no') {
        clearPendingServiceFormOffer(userId);
        return buildGuardResult({
          startTime,
          traceId,
          response: 'Baik Pak/Bu, siap. Kalau Bapak/Ibu mau proses nanti, kabari kami ya.',
          intent: 'QUESTION',
        });
      }

      clearPendingServiceFormOffer(userId);
    }
  }

  const pendingEmergency = await getPendingEmergencyComplaintOfferWithFallback(userId);
  if (!pendingEmergency) {
    return null;
  }

  const confirmationResult = await runWithMicroBudget(
    () => classifyConfirmation(message.trim(), {
      village_id: villageId,
      wa_user_id: userId,
      session_id: userId,
      channel,
    }),
    null,
  );
  const decision = toConfirmationDecision(confirmationResult);

  if (decision === 'yes') {
    clearPendingEmergencyComplaintOffer(userId);
    const complaintResult = await handleComplaintCreation(userId, channel, {
      intent: 'CREATE_COMPLAINT',
      fields: {
        kategori: pendingEmergency.contact_entity || 'darurat',
        ...(pendingEmergency.village_id ? { village_id: pendingEmergency.village_id } : {}),
      },
      reply_text: '',
    }, message);
    const normalized = normalizeHandlerResult(complaintResult);
    return buildGuardResult({
      startTime,
      traceId,
      response: normalized.replyText,
      contacts: normalized.contacts,
      intent: 'CREATE_COMPLAINT',
    });
  }

  if (decision === 'no') {
    clearPendingEmergencyComplaintOffer(userId);
    return buildGuardResult({
      startTime,
      traceId,
      response: 'Baik Pak/Bu. Semoga situasinya segera tertangani. Jangan ragu hubungi kami jika butuh bantuan lagi.',
      intent: 'KNOWLEDGE_QUERY',
    });
  }

  return buildGuardResult({
    startTime,
    traceId,
    response: 'Apakah Bapak/Ibu ingin kami *buatkan laporan pengaduan* terkait situasi darurat ini? Balas *iya* atau *tidak*.',
    intent: 'KNOWLEDGE_QUERY',
  });
}

interface LatePreAgentInput {
  userId: string;
  message: string;
  channel: 'whatsapp' | 'webchat';
  villageId?: string;
  traceId: string;
  startTime: number;
  mediaUrl?: string;
  getUnifiedClassification: () => Promise<UnifiedClassifyResult | null>;
  runWithMicroBudget: MicroBudgetRunner;
  tracker: TrackerLike;
  notifyStage: (stage: string, progress: number) => void;
}

export async function tryHandleLatePreAgentState(
  input: LatePreAgentInput,
): Promise<ProcessMessageResult | null> {
  const {
    userId,
    message,
    channel,
    villageId,
    traceId,
    startTime,
    mediaUrl,
    getUnifiedClassification,
    runWithMicroBudget,
    tracker,
    notifyStage,
  } = input;

  const pendingConfirm = await getPendingAddressConfirmationWithFallback(userId);
  if (pendingConfirm) {
    const confirmResult = await handlePendingAddressConfirmation(
      userId,
      message,
      pendingConfirm,
      channel,
      mediaUrl,
    );
    if (confirmResult) {
      return buildGuardResult({
        startTime,
        traceId,
        response: confirmResult,
        intent: 'CREATE_COMPLAINT',
      });
    }
  }

  const pendingAddr = await getPendingAddressRequestWithFallback(userId);
  if (pendingAddr) {
    const unified = await getUnifiedClassification();
    const isNewIntent = unified?.message_type === 'QUESTION' && unified.confidence >= 0.7;
    const isComplaint = unified?.message_type === 'COMPLAINT' && unified.confidence >= 0.7;
    const isGreeting = unified?.message_type === 'GREETING';
    const isFarewell = unified?.message_type === 'FAREWELL';
    const needsRAG = unified?.rag_needed === true && isNewIntent;

    if (isNewIntent || isComplaint || isGreeting || isFarewell || needsRAG) {
      clearPendingAddressRequest(userId);
    } else {
      const extractedAddr = await extractAddressFromMessage(message, userId, { village_id: pendingAddr.village_id });
      if (extractedAddr && extractedAddr.length >= 5) {
        clearPendingAddressRequest(userId);
        if (mediaUrl) addPendingPhoto(userId, mediaUrl);

        const complaintResult = await handleComplaintCreation(userId, channel, {
          fields: {
            village_id: pendingAddr.village_id,
            kategori: pendingAddr.kategori,
            deskripsi: pendingAddr.deskripsi,
            alamat: extractedAddr,
          },
        }, message);
        const normalized = normalizeHandlerResult(complaintResult);
        return buildGuardResult({
          startTime,
          traceId,
          response: normalized.replyText,
          contacts: normalized.contacts,
          intent: 'CREATE_COMPLAINT',
        });
      }

      if (message.trim().length > 10) {
        const addrAnalysis = await analyzeAddress(message.trim(), {
          village_id: pendingAddr.village_id,
          is_complaint_context: true,
          kategori: pendingAddr.kategori,
        });
        if (addrAnalysis?.quality === 'not_address') {
          return buildGuardResult({
            startTime,
            traceId,
            response: 'Mohon maaf Pak/Bu, saya belum bisa mengenali lokasi dari pesan tersebut. Bisa disebutkan alamat lengkapnya? Misalnya nama jalan, RT/RW, atau patokan terdekat.',
            intent: 'CREATE_COMPLAINT',
          });
        }

        clearPendingAddressRequest(userId);
        if (mediaUrl) addPendingPhoto(userId, mediaUrl);

        const complaintResult = await handleComplaintCreation(userId, channel, {
          fields: {
            village_id: pendingAddr.village_id,
            kategori: pendingAddr.kategori,
            deskripsi: pendingAddr.deskripsi,
            alamat: message.trim(),
          },
        }, message);
        const normalized = normalizeHandlerResult(complaintResult);
        return buildGuardResult({
          startTime,
          traceId,
          response: normalized.replyText,
          contacts: normalized.contacts,
          intent: 'CREATE_COMPLAINT',
        });
      }
    }
  }

  const pendingComplaint = await getPendingComplaintDataWithFallback(userId);
  if (pendingComplaint) {
    const unified = await getUnifiedClassification();
    const isNewIntent = unified?.message_type === 'QUESTION' && unified.confidence >= 0.7;
    const isComplaint = unified?.message_type === 'COMPLAINT' && unified.confidence >= 0.7;
    const isGreeting = unified?.message_type === 'GREETING';
    const isFarewell = unified?.message_type === 'FAREWELL';
    const needsRAG = unified?.rag_needed === true && isNewIntent;

    if (isNewIntent || isComplaint || isGreeting || isFarewell || needsRAG) {
      clearPendingComplaintData(userId);
    } else {
      const userProfile = await getAutoFillSuggestionsWithFallback(userId);

      if (pendingComplaint.waitingFor === 'nama') {
        const extractedName = await extractNameFromTextNLU(message, {
          village_id: villageId,
          wa_user_id: userId,
          session_id: userId,
          channel,
        });
        if (extractedName) {
          updateProfile(userId, { nama_lengkap: extractedName });
          syncNameToChannelService(userId, extractedName, villageId, channel);

          if (pendingComplaint.channel === 'webchat' && !userProfile.no_hp) {
            setPendingComplaintData(userId, {
              ...pendingComplaint,
              waitingFor: 'no_hp',
              timestamp: Date.now(),
            });
            return buildGuardResult({
              startTime,
              traceId,
              response: `Terima kasih Pak/Bu ${extractedName}. Mohon informasikan juga nomor telepon yang dapat dihubungi.`,
              intent: 'CREATE_COMPLAINT',
            });
          }

          clearPendingComplaintData(userId);
          const complaintResult = await handleComplaintCreation(userId, pendingComplaint.channel, {
            fields: {
              village_id: pendingComplaint.village_id,
              kategori: pendingComplaint.kategori,
              deskripsi: pendingComplaint.deskripsi,
              alamat: pendingComplaint.alamat,
              rt_rw: pendingComplaint.rt_rw,
            },
          }, message);
          const normalized = normalizeHandlerResult(complaintResult);
          return buildGuardResult({
            startTime,
            traceId,
            response: normalized.replyText,
            contacts: normalized.contacts,
            intent: 'CREATE_COMPLAINT',
          });
        }

        return buildGuardResult({
          startTime,
          traceId,
          response: 'Mohon maaf Pak/Bu, boleh tuliskan nama lengkap Anda untuk melanjutkan laporan?',
          intent: 'CREATE_COMPLAINT',
        });
      }

      const phoneMatch = message.match(/\b(0[87]\d{8,11}|62[87]\d{8,11}|\+62[87]\d{8,11})\b/);
      if (phoneMatch) {
        const phone = phoneMatch[1].replace(/^\+/, '');
        updateProfile(userId, { no_hp: phone });
        const channelUpper = (pendingComplaint.channel || 'webchat').toUpperCase() as 'WHATSAPP' | 'WEBCHAT';
        updateConversationUserProfile(userId, { user_phone: phone }, pendingComplaint.village_id, channelUpper)
          .catch(() => {});

        clearPendingComplaintData(userId);
        const complaintResult = await handleComplaintCreation(userId, pendingComplaint.channel, {
          fields: {
            village_id: pendingComplaint.village_id,
            kategori: pendingComplaint.kategori,
            deskripsi: pendingComplaint.deskripsi,
            alamat: pendingComplaint.alamat,
            rt_rw: pendingComplaint.rt_rw,
          },
        }, message);
        const normalized = normalizeHandlerResult(complaintResult);
        return buildGuardResult({
          startTime,
          traceId,
          response: normalized.replyText,
          contacts: normalized.contacts,
          intent: 'CREATE_COMPLAINT',
        });
      }

      return buildGuardResult({
        startTime,
        traceId,
        response: 'Mohon maaf Pak/Bu, format nomor telepon sepertinya kurang tepat. Silakan masukkan nomor HP yang valid (contoh: 081234567890).',
        intent: 'CREATE_COMPLAINT',
      });
    }
  }

  if (mediaUrl && message.trim().length < 5) {
    const hasActiveComplaintFlow = pendingAddr || pendingConfirm || pendingComplaint;

    if (hasActiveComplaintFlow) {
      const photoCount = getPendingPhotoCount(userId);
      if (photoCount >= MAX_PHOTOS_PER_COMPLAINT) {
        return buildGuardResult({
          startTime,
          traceId,
          response: `Maaf Pak/Bu, maksimal ${MAX_PHOTOS_PER_COMPLAINT} foto per laporan. Foto sebelumnya sudah kami simpan. Silakan lanjutkan menjawab pertanyaan kami.`,
          intent: 'CREATE_COMPLAINT',
        });
      }

      addPendingPhoto(userId, mediaUrl);
      const newCount = getPendingPhotoCount(userId);
      const remaining = MAX_PHOTOS_PER_COMPLAINT - newCount;
      return buildGuardResult({
        startTime,
        traceId,
        response: `✅ Foto ke-${newCount} sudah kami terima.${remaining > 0 ? ` Anda masih bisa mengirim ${remaining} foto lagi.` : ' Batas foto sudah tercapai.'} Silakan lanjutkan menjawab pertanyaan sebelumnya ya Pak/Bu.`,
        intent: 'CREATE_COMPLAINT',
      });
    }

    addPendingPhoto(userId, mediaUrl);
    const savedProfile = await getAutoFillSuggestionsWithFallback(userId);
    const userName = savedProfile.nama_lengkap;
    const nameGreeting = userName ? ` ${userName}` : '';
    tracker.complete();
    return buildGuardResult({
      startTime,
      traceId,
      response: `Terima kasih Pak/Bu${nameGreeting}, foto sudah kami terima. Jika ingin melaporkan pengaduan, silakan jelaskan masalahnya dan foto akan kami lampirkan otomatis.`,
      intent: 'QUESTION',
    });
  }

  const pendingCancel = await getPendingCancelConfirmationWithFallback(userId);
  if (pendingCancel) {
    const cancelResult = await runWithMicroBudget(
      () => classifyConfirmation(message.trim(), {
        village_id: villageId,
        wa_user_id: userId,
        session_id: userId,
        channel,
      }),
      null,
    );
    const decision = toConfirmationDecision(cancelResult);

    if (decision === 'yes') {
      clearPendingCancelConfirmation(userId);
      if (pendingCancel.type === 'laporan') {
        const result = await cancelComplaint(
          pendingCancel.id,
          buildChannelParams(channel, userId),
          pendingCancel.reason,
        );
        if (result.success) {
          void rememberMemoryEvent({
            wa_user_id: userId,
            village_id: villageId,
            memory_type: 'cancellation',
            memory_key: pendingCancel.id,
            importance: 0.82,
            content: `Laporan ${pendingCancel.id} dibatalkan user.`,
            metadata_json: {
              reference_number: pendingCancel.id,
              reference_type: 'complaint',
              reason: pendingCancel.reason,
            },
          });
        }
        return buildGuardResult({
          startTime,
          traceId,
          response: result.success
            ? buildCancelSuccessResponse('laporan', pendingCancel.id, result.message)
            : buildCancelErrorResponse('laporan', pendingCancel.id, result.error, result.message),
          intent: 'CANCEL_COMPLAINT',
        });
      }

      const serviceResult = await cancelServiceRequest(
        pendingCancel.id,
        buildChannelParams(channel, userId),
        pendingCancel.reason,
      );
      if (serviceResult.success) {
        void rememberMemoryEvent({
          wa_user_id: userId,
          village_id: villageId,
          memory_type: 'cancellation',
          memory_key: pendingCancel.id,
          importance: 0.82,
          content: `Permohonan layanan ${pendingCancel.id} dibatalkan user.`,
          metadata_json: {
            reference_number: pendingCancel.id,
            reference_type: 'service_request',
            reason: pendingCancel.reason,
          },
        });
      }
      return buildGuardResult({
        startTime,
        traceId,
        response: serviceResult.success
          ? buildCancelSuccessResponse('layanan', pendingCancel.id, serviceResult.message)
          : buildCancelErrorResponse('layanan', pendingCancel.id, serviceResult.error, serviceResult.message),
        intent: 'CANCEL_SERVICE_REQUEST',
      });
    }

    if (decision === 'no') {
      clearPendingCancelConfirmation(userId);
      return buildGuardResult({
        startTime,
        traceId,
        response: 'Baik Pak/Bu, laporan/layanan Anda tidak jadi dibatalkan. Ada yang bisa kami bantu lagi?',
        intent: 'QUESTION',
      });
    }

    return buildGuardResult({
      startTime,
      traceId,
      response: 'Mohon konfirmasi ya Pak/Bu. Balas "YA" untuk melanjutkan pembatalan, atau "TIDAK" untuk membatalkan.',
      intent: pendingCancel.type === 'laporan' ? 'CANCEL_COMPLAINT' : 'CANCEL_SERVICE_REQUEST',
    });
  }

  const lapMatch = message.match(/\b(LAP[-\s]?\d{8}[-\s]?\d{3})\b/i);
  const layMatch = message.match(/\b(LAY[-\s]?\d{8}[-\s]?\d{3})\b/i);
  if (lapMatch || layMatch) {
    const rawCode = (lapMatch?.[1] || layMatch?.[1])!.toUpperCase().replace(/\s/g, '');
    const prefix = rawCode.startsWith('LAP') ? 'LAP' : 'LAY';
    const digitsOnly = rawCode.replace(/^(LAP|LAY)-?/, '').replace(/-/g, '');
    const code = `${prefix}-${digitsOnly.slice(0, 8)}-${digitsOnly.slice(8)}`;
    const isLap = prefix === 'LAP';

    tracker.preparing();
    notifyStage('preparing', 80);
    const statusReply = await handleStatusCheck(userId, channel, {
      intent: 'CHECK_STATUS',
      fields: isLap ? { complaint_id: code } : { request_number: code },
      reply_text: '',
    }, message);
    tracker.complete();

    if (channel === 'whatsapp') {
      appendToHistoryCache(userId, 'assistant', statusReply);
    }

    return buildGuardResult({
      startTime,
      traceId,
      response: statusReply,
      intent: 'CHECK_STATUS',
    });
  }

  return null;
}
