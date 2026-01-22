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
        url: 'https://channel.govconnect.my.id',
        description: 'Production server',
      },
    ],
    tags: [
      { name: 'Webhook', description: 'WhatsApp webhook endpoints' },
      { name: 'Internal', description: 'Internal service-to-service APIs' },
      { name: 'WhatsApp Session', description: 'WhatsApp session management' },
      { name: 'Live Chat', description: 'Live chat takeover management' },
      { name: 'Health', description: 'Health check endpoints' },
    ],
    paths: {
      // ============ WEBHOOK ============
      '/webhook/whatsapp': {
        get: {
          tags: ['Webhook'],
          summary: 'WhatsApp webhook verification',
          description: 'Endpoint untuk verifikasi webhook WhatsApp',
          parameters: [
            { in: 'query', name: 'hub.mode', required: true, schema: { type: 'string', enum: ['subscribe'] } },
            { in: 'query', name: 'hub.verify_token', required: true, schema: { type: 'string' } },
            { in: 'query', name: 'hub.challenge', required: true, schema: { type: 'string' } },
          ],
          responses: {
            '200': { description: 'Verification successful - returns challenge' },
            '403': { description: 'Invalid verify token' },
          },
        },
        post: {
          tags: ['Webhook'],
          summary: 'Receive WhatsApp messages',
          description: 'Endpoint untuk menerima pesan dari WhatsApp via Genfity',
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    jid: { type: 'string', example: '6281234567890@s.whatsapp.net' },
                    pushName: { type: 'string', example: 'John Doe' },
                    message: { type: 'object', properties: { conversation: { type: 'string' }, extendedTextMessage: { type: 'object' } } },
                    messageTimestamp: { type: 'integer' },
                  },
                },
              },
            },
          },
          responses: {
            '200': { description: 'Message received', content: { 'application/json': { schema: { type: 'object', properties: { status: { type: 'string' }, message_id: { type: 'string' } } } } } },
            '400': { description: 'Invalid payload' },
          },
        },
      },

      // ============ HEALTH ============
      '/health': {
        get: {
          tags: ['Health'],
          summary: 'Basic health check',
          description: 'Returns basic health status of the service',
          responses: {
            '200': {
              description: 'Service is healthy',
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    properties: {
                      status: { type: 'string', example: 'ok' },
                      service: { type: 'string', example: 'channel-service' },
                      timestamp: { type: 'string', format: 'date-time' },
                    },
                  },
                },
              },
            },
          },
        },
      },
      '/health/db': {
        get: {
          tags: ['Health'],
          summary: 'Database health check',
          description: 'Check PostgreSQL database connectivity',
          responses: {
            '200': {
              description: 'Database is connected',
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    properties: {
                      status: { type: 'string', example: 'ok' },
                      database: { type: 'string', example: 'connected' },
                    },
                  },
                },
              },
            },
            '503': {
              description: 'Database is disconnected',
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    properties: {
                      status: { type: 'string', example: 'error' },
                      database: { type: 'string', example: 'disconnected' },
                      error: { type: 'string' },
                    },
                  },
                },
              },
            },
          },
        },
      },
      '/health/rabbitmq': {
        get: {
          tags: ['Health'],
          summary: 'RabbitMQ health check',
          description: 'Check RabbitMQ message queue connectivity',
          responses: {
            '200': {
              description: 'RabbitMQ is connected',
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    properties: {
                      status: { type: 'string', example: 'ok' },
                      rabbitmq: { type: 'string', example: 'connected' },
                    },
                  },
                },
              },
            },
            '503': {
              description: 'RabbitMQ is disconnected',
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    properties: {
                      status: { type: 'string', example: 'error' },
                      rabbitmq: { type: 'string', example: 'disconnected' },
                    },
                  },
                },
              },
            },
          },
        },
      },

      // ============ INTERNAL MESSAGES ============
      '/internal/messages': {
        get: {
          tags: ['Internal'],
          summary: 'Get message history',
          description: 'Get message history for a WhatsApp user (FIFO 30 messages)',
          security: [{ InternalApiKey: [] }],
          parameters: [
            { in: 'query', name: 'wa_user_id', required: true, schema: { type: 'string' }, description: 'WhatsApp user ID', example: '6281234567890' },
            { in: 'query', name: 'limit', schema: { type: 'integer', default: 30 }, description: 'Max messages to return' },
          ],
          responses: {
            '200': { description: 'Message history', content: { 'application/json': { schema: { type: 'object', properties: { messages: { type: 'array', items: { $ref: '#/components/schemas/Message' } } } } } } },
            '400': { description: 'Missing wa_user_id' },
            '401': { description: 'Unauthorized' },
          },
        },
      },
      '/internal/send': {
        post: {
          tags: ['Internal'],
          summary: 'Send WhatsApp message',
          description: 'Send a message to WhatsApp user via Genfity',
          security: [{ InternalApiKey: [] }],
          requestBody: { required: true, content: { 'application/json': { schema: { $ref: '#/components/schemas/SendMessageRequest' } } } },
          responses: {
            '200': { description: 'Message sent', content: { 'application/json': { schema: { $ref: '#/components/schemas/SendMessageResponse' } } } },
            '400': { description: 'Bad request' },
            '401': { description: 'Unauthorized' },
            '500': { description: 'Failed to send' },
          },
        },
      },
      '/internal/typing': {
        post: {
          tags: ['Internal'],
          summary: 'Send typing indicator',
          security: [{ InternalApiKey: [] }],
          requestBody: {
            required: true,
            content: { 'application/json': { schema: { type: 'object', required: ['wa_user_id', 'state'], properties: { wa_user_id: { type: 'string', example: '6281234567890' }, state: { type: 'string', enum: ['composing', 'paused', 'stop'] } } } } },
          },
          responses: { '200': { description: 'Typing indicator sent' }, '401': { description: 'Unauthorized' } },
        },
      },

      // ============ WHATSAPP SESSION ============
      '/internal/whatsapp/status': {
        get: {
          tags: ['WhatsApp Session'],
          summary: 'Get WhatsApp session status',
          security: [{ InternalApiKey: [] }],
          responses: { '200': { description: 'Session status', content: { 'application/json': { schema: { type: 'object', properties: { connected: { type: 'boolean' }, phone: { type: 'string' }, name: { type: 'string' } } } } } } },
        },
      },
      '/internal/whatsapp/connect': {
        post: {
          tags: ['WhatsApp Session'],
          summary: 'Connect WhatsApp session',
          security: [{ InternalApiKey: [] }],
          responses: { '200': { description: 'Connection initiated' } },
        },
      },
      '/internal/whatsapp/disconnect': {
        post: {
          tags: ['WhatsApp Session'],
          summary: 'Disconnect WhatsApp session',
          description: 'Disconnect but keep session data',
          security: [{ InternalApiKey: [] }],
          responses: { '200': { description: 'Disconnected' } },
        },
      },
      '/internal/whatsapp/logout': {
        post: {
          tags: ['WhatsApp Session'],
          summary: 'Logout WhatsApp session',
          description: 'Full logout - requires QR scan to reconnect',
          security: [{ InternalApiKey: [] }],
          responses: { '200': { description: 'Logged out' } },
        },
      },
      '/internal/whatsapp/qr': {
        get: {
          tags: ['WhatsApp Session'],
          summary: 'Get QR code for authentication',
          security: [{ InternalApiKey: [] }],
          responses: { '200': { description: 'QR code data', content: { 'application/json': { schema: { type: 'object', properties: { qr: { type: 'string' } } } } } } },
        },
      },
      '/internal/whatsapp/pairphone': {
        post: {
          tags: ['WhatsApp Session'],
          summary: 'Pair phone for authentication',
          security: [{ InternalApiKey: [] }],
          requestBody: { content: { 'application/json': { schema: { type: 'object', properties: { phone: { type: 'string', example: '6281234567890' } } } } } },
          responses: { '200': { description: 'Pairing code sent' } },
        },
      },
      '/internal/whatsapp/settings': {
        get: {
          tags: ['WhatsApp Session'],
          summary: 'Get session settings',
          security: [{ InternalApiKey: [] }],
          responses: { '200': { description: 'Current settings' } },
        },
        patch: {
          tags: ['WhatsApp Session'],
          summary: 'Update session settings',
          security: [{ InternalApiKey: [] }],
          requestBody: { content: { 'application/json': { schema: { type: 'object' } } } },
          responses: { '200': { description: 'Settings updated' } },
        },
      },

      // ============ LIVE CHAT TAKEOVER ============
      '/internal/takeover': {
        get: {
          tags: ['Live Chat'],
          summary: 'Get active takeovers',
          security: [{ InternalApiKey: [] }],
          responses: { '200': { description: 'Active takeovers list', content: { 'application/json': { schema: { type: 'array', items: { type: 'object', properties: { wa_user_id: { type: 'string' }, admin_id: { type: 'string' }, admin_name: { type: 'string' }, started_at: { type: 'string', format: 'date-time' } } } } } } } },
        },
      },
      '/internal/takeover/{wa_user_id}': {
        post: {
          tags: ['Live Chat'],
          summary: 'Start takeover',
          description: 'Admin takes control of conversation from AI',
          security: [{ InternalApiKey: [] }],
          parameters: [{ in: 'path', name: 'wa_user_id', required: true, schema: { type: 'string' }, example: '6281234567890' }],
          requestBody: {
            required: true,
            content: { 'application/json': { schema: { type: 'object', required: ['admin_id', 'admin_name'], properties: { admin_id: { type: 'string' }, admin_name: { type: 'string' }, reason: { type: 'string' } } } } },
          },
          responses: { '200': { description: 'Takeover started' }, '409': { description: 'Already in takeover' } },
        },
        delete: {
          tags: ['Live Chat'],
          summary: 'End takeover',
          description: 'Return control to AI',
          security: [{ InternalApiKey: [] }],
          parameters: [{ in: 'path', name: 'wa_user_id', required: true, schema: { type: 'string' } }],
          responses: { '200': { description: 'Takeover ended' } },
        },
      },
      '/internal/takeover/{wa_user_id}/status': {
        get: {
          tags: ['Live Chat'],
          summary: 'Check takeover status',
          security: [{ InternalApiKey: [] }],
          parameters: [{ in: 'path', name: 'wa_user_id', required: true, schema: { type: 'string' } }],
          responses: { '200': { description: 'Takeover status', content: { 'application/json': { schema: { type: 'object', properties: { is_takeover: { type: 'boolean' }, admin_id: { type: 'string' }, admin_name: { type: 'string' } } } } } } },
        },
      },
      '/internal/conversations': {
        get: {
          tags: ['Live Chat'],
          summary: 'Get all conversations',
          security: [{ InternalApiKey: [] }],
          parameters: [{ in: 'query', name: 'status', schema: { type: 'string', enum: ['all', 'ai', 'takeover'] } }],
          responses: { '200': { description: 'Conversations list', content: { 'application/json': { schema: { type: 'array', items: { $ref: '#/components/schemas/Conversation' } } } } } },
        },
      },
      '/internal/conversations/{wa_user_id}': {
        get: {
          tags: ['Live Chat'],
          summary: 'Get conversation detail',
          security: [{ InternalApiKey: [] }],
          parameters: [{ in: 'path', name: 'wa_user_id', required: true, schema: { type: 'string' } }],
          responses: { '200': { description: 'Conversation with messages' } },
        },
        delete: {
          tags: ['Live Chat'],
          summary: 'Delete conversation',
          security: [{ InternalApiKey: [] }],
          parameters: [{ in: 'path', name: 'wa_user_id', required: true, schema: { type: 'string' } }],
          responses: { '200': { description: 'Conversation deleted' } },
        },
      },
      '/internal/conversations/{wa_user_id}/send': {
        post: {
          tags: ['Live Chat'],
          summary: 'Admin send message',
          description: 'Send message as admin (during takeover)',
          security: [{ InternalApiKey: [] }],
          parameters: [{ in: 'path', name: 'wa_user_id', required: true, schema: { type: 'string' } }],
          requestBody: { required: true, content: { 'application/json': { schema: { type: 'object', required: ['message'], properties: { message: { type: 'string', example: 'Terima kasih, laporan sudah kami terima' } } } } } },
          responses: { '200': { description: 'Message sent' } },
        },
      },
      '/internal/conversations/{wa_user_id}/read': {
        post: {
          tags: ['Live Chat'],
          summary: 'Mark as read',
          security: [{ InternalApiKey: [] }],
          parameters: [{ in: 'path', name: 'wa_user_id', required: true, schema: { type: 'string' } }],
          responses: { '200': { description: 'Marked as read' } },
        },
      },
      '/internal/conversations/{wa_user_id}/retry': {
        post: {
          tags: ['Live Chat'],
          summary: 'Retry AI processing',
          security: [{ InternalApiKey: [] }],
          parameters: [{ in: 'path', name: 'wa_user_id', required: true, schema: { type: 'string' } }],
          responses: { '200': { description: 'Retry initiated' } },
        },
      },
    },
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
          },
        },
        HealthResponse: {
          type: 'object',
          properties: {
            status: { type: 'string', enum: ['ok', 'degraded', 'error'] },
            timestamp: { type: 'string', format: 'date-time' },
            service: { type: 'string' },
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
        Message: {
          type: 'object',
          properties: {
            id: { type: 'string' },
            wa_user_id: { type: 'string', example: '6281234567890' },
            direction: { type: 'string', enum: ['incoming', 'outgoing'] },
            content: { type: 'string', example: 'Halo, saya ingin melaporkan kerusakan jalan' },
            message_type: { type: 'string', enum: ['text', 'image', 'document', 'audio', 'video'] },
            timestamp: { type: 'string', format: 'date-time' },
            status: { type: 'string', enum: ['pending', 'sent', 'delivered', 'read', 'failed'] },
          },
        },
        Conversation: {
          type: 'object',
          properties: {
            wa_user_id: { type: 'string', example: '6281234567890' },
            push_name: { type: 'string', example: 'John Doe' },
            last_message: { type: 'string' },
            last_message_at: { type: 'string', format: 'date-time' },
            unread_count: { type: 'integer', example: 3 },
            is_takeover: { type: 'boolean', example: false },
            takeover_admin_id: { type: 'string', nullable: true },
            takeover_admin_name: { type: 'string', nullable: true },
          },
        },
      },
    },
  },
  apis: [],
};

export const swaggerSpec = swaggerJsdoc(options);
