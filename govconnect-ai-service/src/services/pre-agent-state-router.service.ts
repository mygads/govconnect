import {
  cancelComplaint,
  cancelServiceRequest,
} from './case-client.service';
import { updateConversationUserProfile } from './channel-client.service';
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
  getPendingPhotoCount,
  pendingAddressConfirmation,
  pendingAddressRequest,
  pendingCancelConfirmation,
  pendingComplaintData,
  pendingEmergencyComplaintOffer,
  pendingNameConfirmation,
  pendingServiceFormOffer,
  setPendingComplaintData,
  syncNameToChannelService,
} from './ump-state';
import {
  appendToHistoryCache,
  extractAddressFromMessage,
  extractNameFromAssistantPrompt,
  extractNameFromTextNLU,
  getLastAssistantMessage,
} from './ump-utils';
import { getProfile, updateProfile } from './user-profile.service';

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

interface PendingNameInput {
  userId: string;
  message: string;
  channel: 'whatsapp' | 'webchat';
  villageId?: string;
  traceId: string;
  startTime: number;
  runWithMicroBudget: MicroBudgetRunner;
}

export async function tryHandlePendingNameConfirmation(
  input: PendingNameInput,
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

  const pendingName = pendingNameConfirmation.get(userId);
  if (!pendingName) {
    return null;
  }

  const nameResult = await runWithMicroBudget(
    () => classifyConfirmation(message.trim(), {
      village_id: villageId,
      wa_user_id: userId,
      session_id: userId,
      channel,
    }),
    null,
  );
  const decision = toConfirmationDecision(nameResult);

  if (decision === 'yes') {
    pendingNameConfirmation.delete(userId);
    updateProfile(userId, { nama_lengkap: pendingName.name });
    syncNameToChannelService(userId, pendingName.name, villageId, channel);
    return buildGuardResult({
      startTime,
      traceId,
      response: `Baik, terima kasih Pak/Bu ${pendingName.name}. Ada yang bisa kami bantu?`,
      intent: 'QUESTION',
    });
  }

  if (decision === 'no') {
    pendingNameConfirmation.delete(userId);
    return buildGuardResult({
      startTime,
      traceId,
      response: 'Mohon maaf, boleh kami tahu nama yang benar?',
      intent: 'QUESTION',
    });
  }

  return buildGuardResult({
    startTime,
    traceId,
    response: `Baik, apakah benar ini dengan Bapak/Ibu ${pendingName.name}? Balas YA atau BUKAN ya.`,
    intent: 'QUESTION',
  });
}

interface HistoryNameInput extends PendingNameInput {
  conversationHistory?: Array<{ role: 'user' | 'assistant'; content: string }>;
}

export async function tryHandleHistoryNameConfirmation(
  input: HistoryNameInput,
): Promise<ProcessMessageResult | null> {
  const {
    userId,
    message,
    channel,
    villageId,
    traceId,
    startTime,
    conversationHistory,
    runWithMicroBudget,
  } = input;

  const lastPromptedName = extractNameFromAssistantPrompt(
    getLastAssistantMessage(conversationHistory),
  );
  if (!lastPromptedName) {
    return null;
  }

  const historyNameResult = await runWithMicroBudget(
    () => classifyConfirmation(message.trim(), {
      village_id: villageId,
      wa_user_id: userId,
      session_id: userId,
      channel,
    }),
    null,
  );
  const decision = toConfirmationDecision(historyNameResult);

  if (decision === 'yes') {
    updateProfile(userId, { nama_lengkap: lastPromptedName });
    syncNameToChannelService(userId, lastPromptedName, villageId, channel);
    return buildGuardResult({
      startTime,
      traceId,
      response: `Baik, terima kasih Pak/Bu ${lastPromptedName}. Ada yang bisa kami bantu?`,
      intent: 'QUESTION',
    });
  }

  if (decision === 'no') {
    return buildGuardResult({
      startTime,
      traceId,
      response: 'Mohon maaf, boleh kami tahu nama yang benar?',
      intent: 'QUESTION',
    });
  }

  return null;
}

interface PendingOfferInput extends PendingNameInput {}

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

  const pendingOffer = pendingServiceFormOffer.get(userId);
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

  const pendingEmergency = pendingEmergencyComplaintOffer.get(userId);
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
  knownName?: string | null;
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
    knownName,
    getUnifiedClassification,
    runWithMicroBudget,
    tracker,
    notifyStage,
  } = input;

  const pendingConfirm = pendingAddressConfirmation.get(userId);
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

  const pendingAddr = pendingAddressRequest.get(userId);
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

  const pendingComplaint = pendingComplaintData.get(userId);
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
      const userProfile = getProfile(userId);

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
    const hasActiveComplaintFlow = pendingAddressRequest.get(userId)
      || pendingAddressConfirmation.get(userId)
      || pendingComplaintData.get(userId);

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
    const userName = knownName || getProfile(userId).nama_lengkap;
    const nameGreeting = userName ? ` ${userName}` : '';
    tracker.complete();
    return buildGuardResult({
      startTime,
      traceId,
      response: `Terima kasih Pak/Bu${nameGreeting}, foto sudah kami terima. Jika ingin melaporkan pengaduan, silakan jelaskan masalahnya dan foto akan kami lampirkan otomatis.`,
      intent: 'QUESTION',
    });
  }

  const pendingCancel = pendingCancelConfirmation.get(userId);
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
