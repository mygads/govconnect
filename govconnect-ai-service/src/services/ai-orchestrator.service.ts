import logger from '../utils/logger';
import { MessageReceivedEvent } from '../types/event.types';
import { buildContext, buildKnowledgeQueryContext } from './context-builder.service';
import { callGemini } from './llm.service';
import { createComplaint, createTicket } from './case-client.service';
import { publishAIReply } from './rabbitmq.service';
import { isAIChatbotEnabled } from './settings.service';
import { searchKnowledge, buildKnowledgeContext } from './knowledge.service';
import { startTyping, stopTyping } from './channel-client.service';

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
    // Step 0: Check if AI chatbot is enabled
    const aiEnabled = await isAIChatbotEnabled();
    
    if (!aiEnabled) {
      logger.info('⏸️ AI chatbot is disabled, skipping message processing', {
        wa_user_id,
        message_id,
      });
      return; // Exit without processing or replying
    }
    
    // Step 0.5: Send typing indicator BEFORE processing
    await startTyping(wa_user_id);
    
    // Step 1: Build context (fetch history + format prompt)
    const { systemPrompt, messageCount } = await buildContext(wa_user_id, message);
    
    logger.debug('Context built', {
      wa_user_id,
      historyMessages: messageCount,
    });
    
    // Step 2: Call LLM for initial intent detection
    const { response: llmResponse, metrics } = await callGemini(systemPrompt);
    
    // Stop typing after LLM responds
    await stopTyping(wa_user_id);
    
    logger.info('LLM response received', {
      wa_user_id,
      intent: llmResponse.intent,
      needsKnowledge: llmResponse.needs_knowledge,
      durationMs: metrics.durationMs,
    });
    
    // Step 3: Handle intent
    let finalReplyText = llmResponse.reply_text;
    
    switch (llmResponse.intent) {
      case 'CREATE_COMPLAINT':
        finalReplyText = await handleComplaintCreation(wa_user_id, llmResponse, message);
        break;
      
      case 'CREATE_TICKET':
        finalReplyText = await handleTicketCreation(wa_user_id, llmResponse);
        break;
      
      case 'KNOWLEDGE_QUERY':
        // Need to fetch knowledge and do second LLM call
        finalReplyText = await handleKnowledgeQuery(wa_user_id, message, llmResponse);
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
    // Stop typing indicator on error
    await stopTyping(wa_user_id);
    
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
async function handleComplaintCreation(wa_user_id: string, llmResponse: any, currentMessage: string): Promise<string> {
  const { kategori, alamat, rt_rw } = llmResponse.fields;
  let { deskripsi } = llmResponse.fields;
  
  // Fallback: if deskripsi is empty but we have kategori, generate default description
  if (!deskripsi && kategori) {
    // Use kategori as base for description
    const kategoriMap: Record<string, string> = {
      'jalan_rusak': 'Laporan jalan rusak',
      'lampu_mati': 'Laporan lampu jalan mati',
      'sampah': 'Laporan masalah sampah',
      'drainase': 'Laporan saluran air tersumbat',
      'pohon_tumbang': 'Laporan pohon tumbang',
      'fasilitas_rusak': 'Laporan fasilitas umum rusak',
    };
    deskripsi = kategoriMap[kategori] || `Laporan ${kategori.replace(/_/g, ' ')}`;
    
    logger.info('Generated default deskripsi from kategori', {
      wa_user_id,
      kategori,
      deskripsi,
    });
  }
  
  // Check if we have enough information (only kategori is required now)
  if (!kategori) {
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
    deskripsi: deskripsi || `Laporan ${kategori.replace(/_/g, ' ')}`,
    alamat: alamat || '',
    rt_rw: rt_rw || '',
  });
  
  if (complaintId) {
    return `✅ Terima kasih! Laporan Anda telah kami terima dengan nomor ${complaintId}.\n\n${llmResponse.reply_text}`;
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
  
  // Use deskripsi from LLM, or construct from jenis if empty
  const finalDeskripsi = deskripsi || jenis.replace(/_/g, ' ');
  
  logger.info('Creating ticket in Case Service', {
    wa_user_id,
    jenis,
    deskripsi: finalDeskripsi,
  });
  
  // Create ticket in Case Service (SYNC call)
  const ticketId = await createTicket({
    wa_user_id,
    jenis,
    data_json: { deskripsi: finalDeskripsi },
  });
  
  if (ticketId) {
    return `🎫 Tiket Anda telah dibuat dengan nomor ${ticketId}.\\n\\n${llmResponse.reply_text}`;
  } else {
    return `⚠️ Maaf, terjadi kendala saat membuat tiket Anda. Mohon coba lagi atau hubungi kantor kelurahan langsung.`;
  }
}

/**
 * Handle knowledge query - fetch relevant knowledge and do second LLM call
 */
async function handleKnowledgeQuery(wa_user_id: string, message: string, llmResponse: any): Promise<string> {
  logger.info('Handling knowledge query', {
    wa_user_id,
    knowledgeCategory: llmResponse.fields.knowledge_category,
  });
  
  try {
    // Determine categories to search
    const categories = llmResponse.fields.knowledge_category 
      ? [llmResponse.fields.knowledge_category]
      : undefined;
    
    // Search knowledge base
    const knowledgeResult = await searchKnowledge(message, categories);
    
    if (knowledgeResult.total === 0) {
      logger.info('No knowledge found for query', {
        wa_user_id,
        query: message.substring(0, 100),
      });
      
      return 'Maaf, saya belum memiliki informasi tentang hal tersebut. Untuk informasi lebih lanjut, silakan hubungi kantor kelurahan langsung atau datang pada jam kerja.';
    }
    
    // Build context with knowledge
    const { systemPrompt } = await buildKnowledgeQueryContext(
      wa_user_id,
      message,
      knowledgeResult.context
    );
    
    // Second LLM call with knowledge context
    const { response: knowledgeResponse, metrics } = await callGemini(systemPrompt);
    
    logger.info('Knowledge query answered', {
      wa_user_id,
      knowledgeItemsUsed: knowledgeResult.total,
      durationMs: metrics.durationMs,
    });
    
    return knowledgeResponse.reply_text;
  } catch (error: any) {
    logger.error('Failed to handle knowledge query', {
      wa_user_id,
      error: error.message,
    });
    
    return 'Maaf, terjadi kesalahan saat mencari informasi. Mohon coba lagi dalam beberapa saat.';
  }
}
