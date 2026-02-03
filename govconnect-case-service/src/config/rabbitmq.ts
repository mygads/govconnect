export const RABBITMQ_CONFIG = {
  EXCHANGE_NAME: 'govconnect.events',
  EXCHANGE_TYPE: 'topic',
  ROUTING_KEYS: {
    COMPLAINT_CREATED: 'govconnect.complaint.created',
    SERVICE_REQUESTED: 'govconnect.service.requested',
    STATUS_UPDATED: 'govconnect.status.updated',
    URGENT_ALERT: 'govconnect.urgent.alert',
  },
};

// NOTE: Urgent category detection is now handled by ComplaintType.is_urgent in database.
// AI Service passes is_urgent based on the complaint type configuration.
// The hardcoded URGENT_CATEGORIES list has been removed.
