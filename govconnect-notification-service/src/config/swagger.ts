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
      `,
      contact: {
        name: 'GovConnect Team',
        email: 'admin@govconnect.my.id',
      },
    },
    servers: [
      { url: 'http://localhost:3004', description: 'Development' },
      { url: 'https://notification.govconnect.my.id', description: 'Production' },
    ],
    tags: [
      { name: 'Health', description: 'Health check endpoints' },
    ],
    paths: {
      '/': {
        get: {
          tags: ['Health'],
          summary: 'Service info',
          description: 'Returns service information and version',
          responses: {
            '200': {
              description: 'Service information',
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    properties: {
                      service: { type: 'string', example: 'govconnect-notification-service' },
                      version: { type: 'string', example: '1.0.0' },
                      status: { type: 'string', example: 'running' },
                      docs: { type: 'string', example: '/api-docs' },
                      timestamp: { type: 'string', format: 'date-time' },
                    },
                  },
                },
              },
            },
          },
        },
      },
      '/health': {
        get: {
          tags: ['Health'],
          summary: 'Basic health check',
          description: 'Returns basic service health status',
          responses: {
            '200': {
              description: 'Service is healthy',
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    properties: {
                      status: { type: 'string', example: 'ok' },
                      service: { type: 'string', example: 'govconnect-notification-service' },
                      timestamp: { type: 'string', format: 'date-time' },
                    },
                  },
                },
              },
            },
          },
        },
      },
      '/health/database': {
        get: {
          tags: ['Health'],
          summary: 'Database health check',
          description: 'Check database connectivity status',
          responses: {
            '200': {
              description: 'Database connected',
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    properties: {
                      status: { type: 'string', example: 'ok' },
                      database: { type: 'string', example: 'connected' },
                      timestamp: { type: 'string', format: 'date-time' },
                    },
                  },
                },
              },
            },
            '503': {
              description: 'Database disconnected',
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    properties: {
                      status: { type: 'string', example: 'error' },
                      database: { type: 'string', example: 'disconnected' },
                      error: { type: 'string' },
                      timestamp: { type: 'string', format: 'date-time' },
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
          description: 'Check RabbitMQ connectivity status',
          responses: {
            '200': {
              description: 'RabbitMQ connected',
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    properties: {
                      status: { type: 'string', example: 'ok' },
                      rabbitmq: { type: 'string', example: 'connected' },
                      timestamp: { type: 'string', format: 'date-time' },
                    },
                  },
                },
              },
            },
            '503': {
              description: 'RabbitMQ disconnected',
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    properties: {
                      status: { type: 'string', example: 'error' },
                      rabbitmq: { type: 'string', example: 'disconnected' },
                      timestamp: { type: 'string', format: 'date-time' },
                    },
                  },
                },
              },
            },
          },
        },
      },
    },
    components: {
      schemas: {},
    },
  },
  apis: [],
};

export const swaggerSpec = swaggerJsdoc(options);
