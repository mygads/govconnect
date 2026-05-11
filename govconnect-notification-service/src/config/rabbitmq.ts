export const RABBITMQ_CONFIG = {
  exchange: 'govconnect.events',
  exchangeType: 'topic' as const,
  durable: true,
  queues: {
    notification: 'notification-service.events.#'
  },
  routingKeys: {
    // NOTE: aiReply is NOT included here because Channel Service handles it directly
    // Including it here would cause double response to user
    complaintCreated: 'govconnect.complaint.created',
    complaintImportantContacts: 'govconnect.complaint.important_contacts',
    serviceRequested: 'govconnect.service.requested',
    statusUpdated: 'govconnect.status.updated',
    urgentAlert: 'govconnect.urgent.alert'
  }
};
