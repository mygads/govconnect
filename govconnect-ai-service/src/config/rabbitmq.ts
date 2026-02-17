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

  // Prefetch: process 1 message at a time per consumer
  PREFETCH: 1,
};
