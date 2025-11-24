import logger from '../utils/logger';
import { MessageReceivedEvent } from '../types/event.types';
import { buildContext } from './context-builder.service';
import { callGemini } from './llm.service';
import { createComplaint, createTicket } from './case-client.service';
import { publishAIReply } from './rabbitmq.service';

/**
 * Main orchestration logic - processes incoming WhatsApp messages
 */
export async function processMessage(event: MessageReceivedEvent): Promise<void> {
  const { wa_user_id, message, message_id } = event;
  
  logger.info('🎯 Processing message', {
    wa_user_id,
    message_id,
    messageLength: message.length,
  });
  
  try {
    // Step 1: Build context (fetch history + format prompt)
    const { systemPrompt, messageCount } = await buildContext(wa_user_id, message);
    
    logger.debug('Context built', {
      wa_user_id,
      historyMessages: messageCount,
    });
    
    // Step 2: Call LLM
    const { response: llmResponse, metrics } = await callGemini(systemPrompt);
    
    logger.info('LLM response received', {
      wa_user_id,
      intent: llmResponse.intent,
      durationMs: metrics.durationMs,
    });
    
    // Step 3: Handle intent
    let finalReplyText = llmResponse.reply_text;
    
    switch (llmResponse.intent) {
      case 'CREATE_COMPLAINT':
        finalReplyText = await handleComplaintCreation(wa_user_id, llmResponse);
        break;
      
      case 'CREATE_TICKET':
        finalReplyText = await handleTicketCreation(wa_user_id, llmResponse);
        break;
      
      case 'QUESTION':
        // Just use the LLM reply as-is
        logger.info('Question handled', { wa_user_id });
        break;
      
      case 'UNKNOWN':
        logger.warn('Unknown intent', { wa_user_id, message });
        break;
      
      default:
        logger.error('Unhandled intent', {
          wa_user_id,
          intent: llmResponse.intent,
        });
    }
    
    // Step 4: Publish AI reply event (for Notification Service)
    await publishAIReply({
      wa_user_id,
      reply_text: finalReplyText,
    });
    
    logger.info('✅ Message processed successfully', {
      wa_user_id,
      message_id,
      intent: llmResponse.intent,
    });
  } catch (error: any) {
    logger.error('❌ Failed to process message', {
      wa_user_id,
      message_id,
      error: error.message,
    });
    
    // Send fallback reply
    await publishAIReply({
      wa_user_id,
      reply_text: 'Maaf, terjadi kesalahan saat memproses pesan Anda. Mohon coba lagi dalam beberapa saat.',
    });
  }
}

/**
 * Handle complaint creation
 */
async function handleComplaintCreation(wa_user_id: string, llmResponse: any): Promise<string> {
  const { kategori, alamat, deskripsi, rt_rw } = llmResponse.fields;
  
  // Check if we have enough information
  if (!kategori || !deskripsi) {
    logger.info('Incomplete complaint data, asking for more info', {
      wa_user_id,
      hasKategori: !!kategori,
      hasDeskripsi: !!deskripsi,
    });
    return llmResponse.reply_text;
  }
  
  // Create complaint in Case Service (SYNC call)
  const complaintId = await createComplaint({
    wa_user_id,
    kategori,
    deskripsi,
    alamat: alamat || '',
    rt_rw: rt_rw || '',
  });
  
  if (complaintId) {
    return `✅ Terima kasih! Laporan Anda telah kami terima dengan nomor ${complaintId}.\\n\\n${llmResponse.reply_text}`;
  } else {
    return `⚠️ Maaf, terjadi kendala saat memproses laporan Anda. Mohon coba lagi atau hubungi kantor kelurahan langsung.`;
  }
}

/**
 * Handle ticket creation
 */
async function handleTicketCreation(wa_user_id: string, llmResponse: any): Promise<string> {
  const { jenis, deskripsi } = llmResponse.fields;
  
  // Check if we have enough information
  if (!jenis) {
    logger.info('Incomplete ticket data, asking for more info', {
      wa_user_id,
      hasJenis: !!jenis,
    });
    return llmResponse.reply_text;
  }
  
  // Create ticket in Case Service (SYNC call)
  const ticketId = await createTicket({
    wa_user_id,
    jenis,
    data_json: { deskripsi: deskripsi || '' },
  });
  
  if (ticketId) {
    return `🎫 Tiket Anda telah dibuat dengan nomor ${ticketId}.\\n\\n${llmResponse.reply_text}`;
  } else {
    return `⚠️ Maaf, terjadi kendala saat membuat tiket Anda. Mohon coba lagi atau hubungi kantor kelurahan langsung.`;
  }
}
