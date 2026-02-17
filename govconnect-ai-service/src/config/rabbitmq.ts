export const RABBITMQ_CONFIG = {
  EXCHANGE_NAME: 'govconnect.events',
  EXCHANGE_TYPE: 'topic',
  
  // Consumer
  QUEUE_NAME: 'ai-service.whatsapp.message.#',
  ROUTING_KEY_CONSUME: 'whatsapp.message.received',
  
  // Publisher
  ROUTING_KEY_AI_REPLY: 'govconnect.ai.reply',
  ROUTING_KEY_AI_ERROR: 'govconnect.ai.error',
  ROUTING_KEY_MESSAGE_STATUS: 'govconnect.message.status',
  
  // Options
  QUEUE_OPTIONS: {
    durable: true,
    autoDelete: false,
  },
  
  CONSUME_OPTIONS: {
    noAck: false, // Manual acknowledgment
  },

  // Prefetch: allow multiple messages to be consumed concurrently
  // This is CRITICAL for bubble chat — with prefetch=1, messages are serialized,
  // so each message becomes "latest" when it's processed, causing double responses.
  // With prefetch=5, when msg10 arrives while msg9 is being processed by AI,
  // msg10's registerProcessing() supersedes msg9, and shouldSendResponse()
  // correctly suppresses msg9's response.
  PREFETCH: 5,
};
