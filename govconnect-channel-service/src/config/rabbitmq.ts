export const rabbitmqConfig = {
  EXCHANGE_NAME: 'govconnect.events',
  EXCHANGE_TYPE: 'topic' as const,
  ROUTING_KEYS: {
    MESSAGE_RECEIVED: 'whatsapp.message.received',
    MESSAGE_SENT: 'whatsapp.message.sent',
  },
  QUEUES: {
    AI_SERVICE: 'ai-service.whatsapp.message.#',
  },
  OPTIONS: {
    durable: true,
    persistent: true,
  },
};
