export const rabbitmqConfig = {
  EXCHANGE_NAME: 'govconnect.events',
  EXCHANGE_TYPE: 'topic' as const,
  ROUTING_KEYS: {
    MESSAGE_RECEIVED: 'whatsapp.message.received',
    MESSAGE_SENT: 'whatsapp.message.sent',
    AI_REPLY: 'govconnect.ai.reply',
    AI_ERROR: 'govconnect.ai.error',
  },
  QUEUES: {
    AI_SERVICE: 'ai-service.whatsapp.message.#',
    CHANNEL_AI_REPLY: 'channel-service.ai.reply',
    CHANNEL_AI_ERROR: 'channel-service.ai.error',
  },
  OPTIONS: {
    durable: true,
    persistent: true,
  },
};
