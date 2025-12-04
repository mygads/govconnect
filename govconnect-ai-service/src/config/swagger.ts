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

## Flow Processing
1. Terima event dari RabbitMQ (message.received)
2. Ambil chat history dari Channel Service
3. Proses dengan LLM untuk deteksi intent
4. Ekstrak informasi dari percakapan
5. Kirim ke Case Service jika perlu buat laporan/tiket
6. Publish response ke RabbitMQ
      `,
      contact: {
        name: 'GovConnect Team',
        email: 'admin@govconnect.my.id',
      },
    },
    servers: [
      { url: 'http://localhost:3002', description: 'Development' },
      { url: 'https://api.govconnect.my.id/api/ai', description: 'Production' },
    ],
    tags: [
      { name: 'Health', description: 'Health check endpoints' },
      { name: 'Model Stats', description: 'LLM model statistics' },
      { name: 'Analytics', description: 'AI analytics and usage data' },
      { name: 'Rate Limit', description: 'Rate limiting and blacklist management' },
      { name: 'Embeddings', description: 'Embedding and vector stats' },
      { name: 'Circuit Breaker', description: 'Circuit breaker status' },
      { name: 'Document Processing', description: 'Internal document processing and embedding endpoints' },
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
        ProcessMessageRequest: {
          type: 'object',
          required: ['wa_user_id', 'message'],
          properties: {
            wa_user_id: { type: 'string', example: '6281234567890' },
            message: { type: 'string', example: 'Jalan rusak di depan rumah saya' },
          },
        },
        ProcessMessageResponse: {
          type: 'object',
          properties: {
            status: { type: 'string', enum: ['success', 'error'] },
            intent: { type: 'string', enum: ['laporan', 'tiket', 'tanya', 'batal', 'unknown'] },
            response: { type: 'string' },
            extracted_data: {
              type: 'object',
              properties: {
                kategori: { type: 'string' },
                deskripsi: { type: 'string' },
                alamat: { type: 'string' },
              },
            },
            case_created: { type: 'boolean' },
            case_id: { type: 'string' },
          },
        },
        AIStats: {
          type: 'object',
          properties: {
            total_processed: { type: 'integer' },
            success_rate: { type: 'number' },
            avg_response_time_ms: { type: 'number' },
            provider_usage: {
              type: 'object',
              properties: {
                gemini: { type: 'integer' },
                openrouter: { type: 'integer' },
              },
            },
          },
        },
        HealthResponse: {
          type: 'object',
          properties: {
            status: { type: 'string', enum: ['ok', 'degraded', 'error'] },
            timestamp: { type: 'string', format: 'date-time' },
            providers: {
              type: 'object',
              properties: {
                gemini: { type: 'string', enum: ['available', 'unavailable'] },
                openrouter: { type: 'string', enum: ['available', 'unavailable'] },
              },
            },
          },
        },
      },
    },
  },
  apis: ['./src/app.ts', './src/routes/*.ts'],
};

export const swaggerSpec = swaggerJsdoc(options);
