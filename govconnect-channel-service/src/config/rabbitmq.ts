export const rabbitmqConfig = {
  EXCHANGE_NAME: 'govconnect.events',
  EXCHANGE_TYPE: 'topic' as const,
  ROUTING_KEYS: {
    MESSAGE_RECEIVED: 'whatsapp.message.received',
    MESSAGE_SENT: 'whatsapp.message.sent',
    AI_REPLY: 'govconnect.ai.reply',
    AI_ERROR: 'govconnect.ai.error',
    MESSAGE_STATUS: 'govconnect.message.status',
    COMPLAINT_CREATED: 'govconnect.complaint.created',
    COMPLAINT_STATUS_UPDATED: 'govconnect.status.updated',
    COMPLAINT_URGENT_ALERT: 'govconnect.urgent.alert',
  },
  QUEUES: {
    AI_SERVICE: 'ai-service.whatsapp.message.#',
    CHANNEL_AI_REPLY: 'channel-service.ai.reply',
    CHANNEL_AI_ERROR: 'channel-service.ai.error',
    CHANNEL_MESSAGE_STATUS: 'channel-service.message.status',
    CHANNEL_COMPLAINT_EVENTS: 'channel-service.complaint.events',
  },
  OPTIONS: {
    durable: true,
    persistent: true,
  },
};
