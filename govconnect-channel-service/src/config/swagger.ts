import swaggerJsdoc from 'swagger-jsdoc';

const options: swaggerJsdoc.Options = {
  definition: {
    openapi: '3.0.3',
    info: {
      title: 'GovConnect Channel Service API',
      version: '1.0.0',
      description: `
# Channel Service API

Channel Service adalah **pintu gerbang WhatsApp** untuk sistem GovConnect.

## Fitur Utama
- Menerima webhook dari WhatsApp API (Genfity)
- Menyimpan history chat (FIFO 30 messages)
- Internal API untuk kirim pesan
- Takeover management untuk live chat

## Authentication
- **Internal APIs**: Membutuhkan header \`X-Internal-API-Key\`
- **Webhook**: Verified via verify token

## Rate Limiting
- Webhook: 100 requests/second
- Internal: 500 requests/second
      `,
      contact: {
        name: 'GovConnect Team',
        email: 'admin@govconnect.my.id',
      },
      license: {
        name: 'MIT',
        url: 'https://opensource.org/licenses/MIT',
      },
    },
    servers: [
      {
        url: 'http://localhost:3001',
        description: 'Development server',
      },
      {
        url: 'https://api.govconnect.my.id',
        description: 'Production server',
      },
    ],
    tags: [
      {
        name: 'Webhook',
        description: 'WhatsApp webhook endpoints',
      },
      {
        name: 'Internal',
        description: 'Internal service-to-service APIs',
      },
      {
        name: 'WhatsApp Session',
        description: 'WhatsApp session management (connect, disconnect, QR)',
      },
      {
        name: 'Live Chat',
        description: 'Live chat takeover and conversation management',
      },
      {
        name: 'Health',
        description: 'Health check endpoints',
      },
    ],
    components: {
      securitySchemes: {
        InternalApiKey: {
          type: 'apiKey',
          in: 'header',
          name: 'X-Internal-API-Key',
          description: 'API Key untuk internal service calls',
        },
      },
      schemas: {
        Error: {
          type: 'object',
          properties: {
            error: { type: 'string', example: 'Bad Request' },
            message: { type: 'string', example: 'Invalid request body' },
            details: { type: 'array', items: { type: 'object' } },
          },
        },
        HealthResponse: {
          type: 'object',
          properties: {
            status: { type: 'string', enum: ['ok', 'degraded', 'error'], example: 'ok' },
            timestamp: { type: 'string', format: 'date-time' },
            uptime: { type: 'number', description: 'Uptime in seconds' },
            version: { type: 'string' },
          },
        },
        Message: {
          type: 'object',
          properties: {
            id: { type: 'string' },
            wa_user_id: { type: 'string', example: '6281234567890' },
            message_text: { type: 'string' },
            direction: { type: 'string', enum: ['IN', 'OUT'] },
            source: { type: 'string', enum: ['WA_WEBHOOK', 'AI', 'SYSTEM', 'ADMIN'] },
            timestamp: { type: 'string', format: 'date-time' },
          },
        },
        SendMessageRequest: {
          type: 'object',
          required: ['wa_user_id', 'message'],
          properties: {
            wa_user_id: { type: 'string', example: '6281234567890' },
            message: { type: 'string', example: 'Laporan Anda sudah diterima' },
          },
        },
        SendMessageResponse: {
          type: 'object',
          properties: {
            status: { type: 'string', enum: ['sent', 'failed'] },
            message_id: { type: 'string' },
            error: { type: 'string' },
          },
        },
        Conversation: {
          type: 'object',
          properties: {
            wa_user_id: { type: 'string' },
            user_name: { type: 'string' },
            last_message: { type: 'string' },
            last_message_at: { type: 'string', format: 'date-time' },
            unread_count: { type: 'integer' },
            is_takeover: { type: 'boolean' },
          },
        },
      },
    },
  },
  apis: ['./src/routes/*.ts'],
};

export const swaggerSpec = swaggerJsdoc(options);
