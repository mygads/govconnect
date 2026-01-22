import swaggerJsdoc from 'swagger-jsdoc';

const options: swaggerJsdoc.Options = {
  definition: {
    openapi: '3.0.3',
    info: {
      title: 'GovConnect AI Service API',
      version: '1.0.0',
      description: `
# AI Service API

AI Service adalah **otak AI** untuk sistem GovConnect.

## Fitur Utama
- Intent detection dari pesan warga
- Ekstraksi data (kategori, alamat, deskripsi)
- Multi-provider LLM (Gemini, OpenRouter)
- Fallback mechanism untuk reliability
- RAG dengan knowledge base
      `,
      contact: {
        name: 'GovConnect Team',
        email: 'admin@govconnect.my.id',
      },
    },
    servers: [
      { url: 'http://localhost:3002', description: 'Development' },
      { url: 'https://ai.govconnect.my.id', description: 'Production' },
    ],
    tags: [
      { name: 'Health', description: 'Health check endpoints' },
      { name: 'Model Stats', description: 'LLM model statistics' },
      { name: 'Analytics', description: 'AI analytics and usage data' },
      { name: 'Rate Limit', description: 'Rate limiting and blacklist management' },
      { name: 'Embeddings', description: 'Embedding and vector stats' },
      { name: 'Circuit Breaker', description: 'Circuit breaker status' },
      { name: 'Document Processing', description: 'Internal document and embedding endpoints' },
    ],
    paths: {
      '/': {
        get: {
          tags: ['Health'],
          summary: 'Service info',
          description: 'Returns service information and available endpoints',
          responses: {
            '200': {
              description: 'Service info',
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    properties: {
                      service: { type: 'string', example: 'GovConnect AI Orchestrator' },
                      version: { type: 'string', example: '1.0.0' },
                      status: { type: 'string', example: 'running' },
                      docs: { type: 'string', example: '/api-docs' },
                      endpoints: { type: 'object' },
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
                      service: { type: 'string', example: 'ai-orchestrator' },
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
              description: 'RabbitMQ status',
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    properties: {
                      status: { type: 'string', enum: ['connected', 'disconnected'] },
                      service: { type: 'string', example: 'ai-orchestrator' },
                    },
                  },
                },
              },
            },
          },
        },
      },
      '/health/services': {
        get: {
          tags: ['Health'],
          summary: 'Dependent services health check',
          description: 'Check connectivity to Channel Service and Case Service',
          responses: {
            '200': {
              description: 'Services status',
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    properties: {
                      status: { type: 'string', enum: ['ok', 'degraded'] },
                      services: {
                        type: 'object',
                        properties: {
                          channelService: { type: 'string', enum: ['healthy', 'unhealthy'] },
                          caseService: { type: 'string', enum: ['healthy', 'unhealthy'] },
                        },
                      },
                    },
                  },
                },
              },
            },
          },
        },
      },
      '/stats/models': {
        get: {
          tags: ['Model Stats'],
          summary: 'Get all LLM model statistics',
          description: 'Returns statistics for all LLM models used by the AI service',
          responses: {
            '200': {
              description: 'Model statistics',
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    properties: {
                      summary: {
                        type: 'object',
                        properties: {
                          totalRequests: { type: 'integer' },
                          lastUpdated: { type: 'string', format: 'date-time' },
                          totalModels: { type: 'integer' },
                        },
                      },
                      models: {
                        type: 'array',
                        items: {
                          type: 'object',
                          properties: {
                            model: { type: 'string' },
                            successRate: { type: 'string', example: '95%' },
                            totalCalls: { type: 'integer' },
                            avgResponseTimeMs: { type: 'number' },
                          },
                        },
                      },
                    },
                  },
                },
              },
            },
          },
        },
      },
      '/stats/models/{modelName}': {
        get: {
          tags: ['Model Stats'],
          summary: 'Get detailed model statistics',
          parameters: [{ in: 'path', name: 'modelName', required: true, schema: { type: 'string' } }],
          responses: { '200': { description: 'Model details' }, '404': { description: 'Not found' } },
        },
      },
      '/stats/analytics': {
        get: {
          tags: ['Analytics'],
          summary: 'Get AI analytics summary',
          responses: { '200': { description: 'Analytics summary' } },
        },
      },
      '/stats/analytics/intents': {
        get: {
          tags: ['Analytics'],
          summary: 'Get intent distribution',
          responses: { '200': { description: 'Intent distribution' } },
        },
      },
      '/stats/analytics/flow': {
        get: {
          tags: ['Analytics'],
          summary: 'Get conversation flow patterns',
          responses: { '200': { description: 'Flow patterns' } },
        },
      },
      '/stats/analytics/tokens': {
        get: {
          tags: ['Analytics'],
          summary: 'Get token usage breakdown',
          responses: { '200': { description: 'Token usage' } },
        },
      },
      '/stats/analytics/full': {
        get: {
          tags: ['Analytics'],
          summary: 'Get full analytics data for export',
          responses: { '200': { description: 'Full analytics' } },
        },
      },
      '/stats/embeddings': {
        get: {
          tags: ['Embeddings'],
          summary: 'Get embedding stats',
          responses: { '200': { description: 'Embedding statistics' } },
        },
      },
      '/stats/circuit-breaker': {
        get: {
          tags: ['Circuit Breaker'],
          summary: 'Get circuit breaker status',
          responses: { '200': { description: 'Circuit breaker state' } },
        },
      },
      '/rate-limit': {
        get: {
          tags: ['Rate Limit'],
          summary: 'Get rate limiter config and stats',
          responses: { '200': { description: 'Rate limit config' } },
        },
      },
      '/rate-limit/check/{wa_user_id}': {
        get: {
          tags: ['Rate Limit'],
          summary: 'Check rate limit for user',
          parameters: [{ in: 'path', name: 'wa_user_id', required: true, schema: { type: 'string' } }],
          responses: { '200': { description: 'User rate limit status' } },
        },
      },
      '/rate-limit/blacklist': {
        get: {
          tags: ['Rate Limit'],
          summary: 'Get blacklist',
          responses: { '200': { description: 'Blacklist entries' } },
        },
        post: {
          tags: ['Rate Limit'],
          summary: 'Add user to blacklist',
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  required: ['wa_user_id', 'reason'],
                  properties: {
                    wa_user_id: { type: 'string' },
                    reason: { type: 'string' },
                    expiresInDays: { type: 'integer' },
                  },
                },
              },
            },
          },
          responses: { '200': { description: 'Added to blacklist' } },
        },
      },
      '/rate-limit/blacklist/{wa_user_id}': {
        delete: {
          tags: ['Rate Limit'],
          summary: 'Remove user from blacklist',
          parameters: [{ in: 'path', name: 'wa_user_id', required: true, schema: { type: 'string' } }],
          responses: { '200': { description: 'Removed' }, '404': { description: 'Not in blacklist' } },
        },
      },
      '/rate-limit/reset/{wa_user_id}': {
        post: {
          tags: ['Rate Limit'],
          summary: 'Reset user violations',
          parameters: [{ in: 'path', name: 'wa_user_id', required: true, schema: { type: 'string' } }],
          responses: { '200': { description: 'Violations reset' } },
        },
      },
      '/api/knowledge/embed-all': {
        post: {
          tags: ['Knowledge'],
          summary: 'Embed all knowledge items',
          description: 'Bulk embed all knowledge items from Dashboard',
          security: [{ InternalApiKey: [] }],
          responses: { '200': { description: 'Batch embedding completed' }, '403': { description: 'Unauthorized' } },
        },
      },
    },
    components: {
      securitySchemes: {
        InternalApiKey: {
          type: 'apiKey',
          in: 'header',
          name: 'X-Internal-API-Key',
        },
      },
      schemas: {},
    },
  },
  apis: [],
};

export const swaggerSpec = swaggerJsdoc(options);
