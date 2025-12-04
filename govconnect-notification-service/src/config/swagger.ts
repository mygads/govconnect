import swaggerJsdoc from 'swagger-jsdoc';

const options: swaggerJsdoc.Options = {
  definition: {
    openapi: '3.0.3',
    info: {
      title: 'GovConnect Notification Service API',
      version: '1.0.0',
      description: `
# Notification Service API

Notification Service mengelola **pengiriman notifikasi** ke warga melalui WhatsApp.

## Fitur Utama
- Template-based notifications
- Status update notifications
- Queue-based async sending via RabbitMQ
- Delivery status tracking

## Notification Types
- Konfirmasi laporan diterima
- Update status laporan/tiket
- Reminder follow-up
- Broadcast announcements
      `,
      contact: {
        name: 'GovConnect Team',
        email: 'admin@govconnect.my.id',
      },
    },
    servers: [
      { url: 'http://localhost:3004', description: 'Development' },
      { url: 'https://api.govconnect.my.id/api/notifications', description: 'Production' },
    ],
    tags: [
      { name: 'Notifications', description: 'Notification management' },
      { name: 'Templates', description: 'Notification templates' },
      { name: 'Health', description: 'Health checks' },
    ],
    components: {
      securitySchemes: {
        InternalApiKey: {
          type: 'apiKey',
          in: 'header',
          name: 'X-Internal-API-Key',
        },
      },
      schemas: {
        SendNotificationRequest: {
          type: 'object',
          required: ['wa_user_id', 'template', 'data'],
          properties: {
            wa_user_id: { type: 'string', example: '6281234567890' },
            template: { type: 'string', enum: ['complaint_received', 'complaint_status', 'ticket_received', 'ticket_status'] },
            data: {
              type: 'object',
              properties: {
                case_id: { type: 'string' },
                status: { type: 'string' },
                message: { type: 'string' },
              },
            },
          },
        },
        NotificationResponse: {
          type: 'object',
          properties: {
            status: { type: 'string', enum: ['queued', 'sent', 'failed'] },
            notification_id: { type: 'string' },
            message: { type: 'string' },
          },
        },
        NotificationLog: {
          type: 'object',
          properties: {
            id: { type: 'string' },
            wa_user_id: { type: 'string' },
            template: { type: 'string' },
            status: { type: 'string', enum: ['pending', 'sent', 'failed'] },
            sent_at: { type: 'string', format: 'date-time' },
            error: { type: 'string' },
          },
        },
        HealthResponse: {
          type: 'object',
          properties: {
            status: { type: 'string', enum: ['ok', 'degraded', 'error'] },
            timestamp: { type: 'string', format: 'date-time' },
            queue_status: { type: 'string' },
          },
        },
      },
    },
  },
  apis: ['./src/app.ts', './src/routes/*.ts'],
};

export const swaggerSpec = swaggerJsdoc(options);
