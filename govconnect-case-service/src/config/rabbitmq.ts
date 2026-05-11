export const RABBITMQ_CONFIG = {
  EXCHANGE_NAME: 'govconnect.events',
  EXCHANGE_TYPE: 'topic',
  ROUTING_KEYS: {
    COMPLAINT_CREATED: 'govconnect.complaint.created',
    COMPLAINT_IMPORTANT_CONTACTS: 'govconnect.complaint.important_contacts',
    SERVICE_REQUESTED: 'govconnect.service.requested',
    STATUS_UPDATED: 'govconnect.status.updated',
    URGENT_ALERT: 'govconnect.urgent.alert',
    COMPLAINT_ARCHIVED: 'govconnect.complaint.archived',
    COMPLAINT_RESTORED: 'govconnect.complaint.restored',
    SERVICE_REQUEST_ARCHIVED: 'govconnect.service_request.archived',
    SERVICE_REQUEST_RESTORED: 'govconnect.service_request.restored',
  },
};

// NOTE: Urgent category detection is now handled by ComplaintType.is_urgent in database.
// AI Service passes is_urgent based on the complaint type configuration.
// The hardcoded URGENT_CATEGORIES list has been removed.
