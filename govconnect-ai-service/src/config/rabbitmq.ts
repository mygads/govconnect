export const RABBITMQ_CONFIG = {
  EXCHANGE_NAME: 'govconnect.events',
  EXCHANGE_TYPE: 'topic',
  
  // Consumer
  QUEUE_NAME: 'ai-service.whatsapp.message.#',
  ROUTING_KEY_CONSUME: 'whatsapp.message.received',
  
  // Publisher
  ROUTING_KEY_AI_REPLY: 'govconnect.ai.reply',
  
  // Options
  QUEUE_OPTIONS: {
    durable: true,
    autoDelete: false,
  },
  
  CONSUME_OPTIONS: {
    noAck: false, // Manual acknowledgment
  },
};
