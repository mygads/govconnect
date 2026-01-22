import swaggerJsdoc from 'swagger-jsdoc';

const options: swaggerJsdoc.Options = {
  definition: {
    openapi: '3.0.3',
    info: {
      title: 'GovConnect Case Service API',
      version: '1.0.0',
      description: `
# Case Service API

Case Service mengelola **Laporan Warga** dan **Permohonan Layanan** dalam sistem GovConnect.

## Entities

### Laporan (Complaint)
- Pengaduan tentang masalah infrastruktur
- Kategori: jalan_rusak, lampu_mati, sampah, drainase, pohon_tumbang, fasilitas_rusak
- Status: baru → proses → selesai/ditolak

### Permohonan Layanan (Service Requests)
- Permohonan layanan administrasi dari warga
- Status: baru → proses → selesai/ditolak/dibatalkan

## Authentication
- Internal APIs: Header \`X-Internal-API-Key\`
      `,
      contact: {
        name: 'GovConnect Team',
        email: 'admin@govconnect.my.id',
      },
    },
    servers: [
      { url: 'http://localhost:3003', description: 'Development' },
      { url: 'https://case.govconnect.my.id', description: 'Production' },
    ],
    tags: [
      { name: 'Laporan', description: 'Complaint/report management' },
      { name: 'Permohonan Layanan', description: 'Service request management' },
      { name: 'Layanan', description: 'Government services management' },
      { name: 'Statistics', description: 'Dashboard statistics' },
      { name: 'User', description: 'User history' },
      { name: 'Health', description: 'Health checks' },
    ],
    paths: {
      // ============ LAPORAN (COMPLAINTS) ============
      '/laporan/create': {
        post: {
          tags: ['Laporan'],
          summary: 'Create new complaint',
          description: 'Create a new complaint (from AI Service - internal only)',
          security: [{ InternalApiKey: [] }],
          requestBody: { required: true, content: { 'application/json': { schema: { $ref: '#/components/schemas/CreateComplaintRequest' } } } },
          responses: {
            '201': { description: 'Complaint created', content: { 'application/json': { schema: { $ref: '#/components/schemas/Complaint' } } } },
            '400': { description: 'Validation error' },
            '401': { description: 'Unauthorized' },
          },
        },
      },
      '/laporan': {
        get: {
          tags: ['Laporan'],
          summary: 'Get complaints list',
          description: 'Get paginated list of complaints with optional filters',
          parameters: [
            { in: 'query', name: 'status', schema: { type: 'string', enum: ['baru', 'proses', 'selesai', 'ditolak'] }, description: 'Filter by status' },
            { in: 'query', name: 'kategori', schema: { type: 'string' }, description: 'Filter by kategori' },
            { in: 'query', name: 'limit', schema: { type: 'integer', default: 20 }, description: 'Items per page' },
            { in: 'query', name: 'offset', schema: { type: 'integer', default: 0 }, description: 'Pagination offset' },
          ],
          responses: { '200': { description: 'List of complaints', content: { 'application/json': { schema: { type: 'object', properties: { data: { type: 'array', items: { $ref: '#/components/schemas/Complaint' } }, pagination: { $ref: '#/components/schemas/Pagination' } } } } } } },
        },
      },
      '/laporan/statistics': {
        get: {
          tags: ['Laporan'],
          summary: 'Get complaint statistics',
          responses: { '200': { description: 'Statistics', content: { 'application/json': { schema: { type: 'object', properties: { total: { type: 'integer' }, byStatus: { type: 'object' }, byKategori: { type: 'object' } } } } } } },
        },
      },
      '/laporan/{id}': {
        get: {
          tags: ['Laporan'],
          summary: 'Get complaint by ID',
          parameters: [{ in: 'path', name: 'id', required: true, schema: { type: 'string' }, description: 'Complaint ID (LAP-YYYYMMDD-XXX or UUID)' }],
          responses: { '200': { description: 'Complaint detail', content: { 'application/json': { schema: { $ref: '#/components/schemas/Complaint' } } } }, '404': { description: 'Not found' } },
        },
      },
      '/laporan/{id}/status': {
        patch: {
          tags: ['Laporan'],
          summary: 'Update complaint status',
          description: 'Update status of a complaint (for Dashboard admin)',
          parameters: [{ in: 'path', name: 'id', required: true, schema: { type: 'string' } }],
          requestBody: {
            required: true,
            content: { 'application/json': { schema: { type: 'object', required: ['status'], properties: { status: { type: 'string', enum: ['baru', 'proses', 'selesai', 'ditolak'] }, admin_notes: { type: 'string', description: 'Notes from admin' } } } } },
          },
          responses: { '200': { description: 'Status updated', content: { 'application/json': { schema: { $ref: '#/components/schemas/Complaint' } } } }, '404': { description: 'Not found' } },
        },
      },
      '/laporan/{id}/cancel': {
        post: {
          tags: ['Laporan'],
          summary: 'Cancel complaint by user',
          description: 'User cancels their own complaint (from AI Service)',
          security: [{ InternalApiKey: [] }],
          parameters: [{ in: 'path', name: 'id', required: true, schema: { type: 'string' } }],
          requestBody: {
            required: true,
            content: { 'application/json': { schema: { type: 'object', required: ['wa_user_id'], properties: { wa_user_id: { type: 'string', example: '6281234567890' }, cancel_reason: { type: 'string' } } } } },
          },
          responses: { '200': { description: 'Complaint cancelled' }, '404': { description: 'Not found' } },
        },
      },

      '/services': {
        get: {
          tags: ['Layanan'],
          summary: 'Get all services',
          responses: { '200': { description: 'List of all services' } },
        },
      },
      '/services/{id}': {
        get: {
          tags: ['Layanan'],
          summary: 'Get service by ID',
          parameters: [{ in: 'path', name: 'id', required: true, schema: { type: 'string' } }],
          responses: { '200': { description: 'Service detail' }, '404': { description: 'Not found' } },
        },
      },
      '/service-requests': {
        get: {
          tags: ['Permohonan Layanan'],
          summary: 'Get service requests list',
          responses: { '200': { description: 'List of service requests' } },
        },
      },
      '/service-requests/{id}': {
        get: {
          tags: ['Permohonan Layanan'],
          summary: 'Get service request by ID',
          parameters: [{ in: 'path', name: 'id', required: true, schema: { type: 'string' } }],
          responses: { '200': { description: 'Service request detail' }, '404': { description: 'Not found' } },
        },
      },

      // ============ STATISTICS ============
      '/statistics/overview': {
        get: {
          tags: ['Statistics'],
          summary: 'Get overall statistics',
          responses: { '200': { description: 'Statistics data', content: { 'application/json': { schema: { $ref: '#/components/schemas/Statistics' } } } } },
        },
      },
      '/statistics/by-category': {
        get: {
          tags: ['Statistics'],
          summary: 'Get statistics by category',
          responses: { '200': { description: 'Category statistics' } },
        },
      },
      '/statistics/by-status': {
        get: {
          tags: ['Statistics'],
          summary: 'Get statistics by status',
          responses: { '200': { description: 'Status statistics' } },
        },
      },
      '/statistics/trends': {
        get: {
          tags: ['Statistics'],
          summary: 'Get trend analysis',
          parameters: [{ in: 'query', name: 'period', schema: { type: 'string', enum: ['weekly', 'monthly'] } }],
          responses: { '200': { description: 'Trend data' } },
        },
      },

      // ============ USER HISTORY ============
      '/user/{wa_user_id}/history': {
        get: {
          tags: ['User'],
          summary: 'Get user history',
          description: 'Get complaint and service request history for a user',
          security: [{ InternalApiKey: [] }],
          parameters: [{ in: 'path', name: 'wa_user_id', required: true, schema: { type: 'string' } }],
          responses: { '200': { description: 'User complaint and service request history' } },
        },
      },

      // ============ HEALTH ============
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
                      service: { type: 'string', example: 'govconnect-case-service' },
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
                      error: { type: 'string' },
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
      securitySchemes: {
        InternalApiKey: {
          type: 'apiKey',
          in: 'header',
          name: 'X-Internal-API-Key',
        },
      },
      schemas: {
        CreateComplaintRequest: {
          type: 'object',
          required: ['wa_user_id', 'kategori', 'deskripsi'],
          properties: {
            wa_user_id: { type: 'string', example: '6281234567890' },
            kategori: { type: 'string', enum: ['jalan_rusak', 'lampu_mati', 'sampah', 'drainase', 'pohon_tumbang', 'fasilitas_rusak'] },
            deskripsi: { type: 'string' },
            alamat: { type: 'string' },
            rt_rw: { type: 'string' },
            foto_url: { type: 'string' },
          },
        },
        Statistics: {
          type: 'object',
          properties: {
            totalLaporan: { type: 'integer' },
            totalServiceRequests: { type: 'integer' },
            laporan: { type: 'object' },
            serviceRequests: { type: 'object' },
          },
        },
        Complaint: {
          type: 'object',
          properties: {
            id: { type: 'string', example: 'LAP-20250125-001' },
            wa_user_id: { type: 'string', example: '6281234567890' },
            kategori: { type: 'string', enum: ['jalan_rusak', 'lampu_mati', 'sampah', 'drainase', 'pohon_tumbang', 'fasilitas_rusak', 'banjir', 'tindakan_kriminal', 'lainnya'] },
            deskripsi: { type: 'string' },
            alamat: { type: 'string' },
            rt_rw: { type: 'string' },
            foto_url: { type: 'string', nullable: true },
            status: { type: 'string', enum: ['baru', 'proses', 'selesai', 'ditolak'] },
            admin_notes: { type: 'string', nullable: true },
            created_at: { type: 'string', format: 'date-time' },
            updated_at: { type: 'string', format: 'date-time' },
          },
        },
        Pagination: {
          type: 'object',
          properties: {
            total: { type: 'integer', example: 100 },
            limit: { type: 'integer', example: 20 },
            offset: { type: 'integer', example: 0 },
            hasMore: { type: 'boolean', example: true },
          },
        },
      },
    },
  },
  apis: [],
};

export const swaggerSpec = swaggerJsdoc(options);
