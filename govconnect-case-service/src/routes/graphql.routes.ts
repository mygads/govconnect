/**
 * GraphQL Schema and Resolvers for Public Forms
 * 
 * Provides GraphQL API for:
 * - Service listing with dynamic citizen questions
 * - Complaint submission
 * - Reservation with slot availability
 */

import { ApolloServer, BaseContext } from '@apollo/server';
import { Router, json, Request, Response } from 'express';
import cors from 'cors';
import {
  GOVERNMENT_SERVICES,
  COMMON_CITIZEN_QUESTIONS,
  getServiceByCode,
  getQuestionsForService,
  DEFAULT_OPERATING_HOURS
} from '../config/services';
import * as complaintService from '../services/complaint.service';
import * as reservationService from '../services/reservation.service';
import logger from '../utils/logger';

// ==================== TYPE DEFINITIONS ====================

const typeDefs = `#graphql
  type CitizenQuestion {
    field: String!
    question: String!
    type: String!
    required: Boolean!
    options: [String!]
  }

  type Service {
    code: String!
    name: String!
    description: String!
    category: String!
    requirements: [String!]!
    sop_steps: [String!]!
    estimated_duration: Int!
    daily_quota: Int!
    citizen_questions: [CitizenQuestion!]!
    all_questions: [CitizenQuestion!]!
    is_active: Boolean
    is_online_available: Boolean
  }

  type TimeSlot {
    time: String!
    available: Boolean!
    remaining: Int
  }

  type AvailableSlots {
    service_code: String!
    date: String!
    day_name: String!
    is_open: Boolean!
    slots: [TimeSlot!]!
    daily_quota: Int!
    total_booked: Int!
  }

  type Complaint {
    id: String!
    complaint_id: String!
    kategori: String!
    deskripsi: String!
    alamat: String
    rt_rw: String
    foto_url: String
    status: String!
    created_at: String!
  }

  type Reservation {
    id: String!
    reservation_id: String!
    service_code: String!
    service_name: String!
    citizen_data: String
    reservation_date: String!
    reservation_time: String!
    queue_number: Int!
    status: String!
    created_at: String!
  }

  type ComplaintCategory {
    code: String!
    name: String!
    description: String!
    icon: String!
  }

  # Input types
  input CreateComplaintInput {
    kategori: String!
    deskripsi: String!
    alamat: String
    rt_rw: String
    foto_url: String
    nama_pelapor: String!
    no_hp: String!
  }

  input CreateReservationInput {
    service_code: String!
    reservation_date: String!
    reservation_time: String!
    nama_lengkap: String!
    nik: String!
    alamat: String!
    no_hp: String!
    additional_data: String
  }

  # Response types
  type CreateComplaintResponse {
    success: Boolean!
    complaint_id: String
    message: String
    error: String
  }

  type CreateReservationResponse {
    success: Boolean!
    reservation_id: String
    queue_number: Int
    message: String
    error: String
  }

  type Query {
    # Get all active services
    services: [Service!]!
    
    # Get service by code
    service(code: String!): Service
    
    # Get available time slots for a service on a date
    availableSlots(serviceCode: String!, date: String!): AvailableSlots
    
    # Get complaint categories
    complaintCategories: [ComplaintCategory!]!
  }

  type Mutation {
    # Create a complaint
    createComplaint(input: CreateComplaintInput!): CreateComplaintResponse!
    
    # Create a reservation
    createReservation(input: CreateReservationInput!): CreateReservationResponse!
  }
`;

// ==================== RESOLVERS ====================

// Complaint categories with icons
const COMPLAINT_CATEGORIES = [
  { code: 'jalan_rusak', name: 'Jalan Rusak', description: 'Kerusakan jalan, lubang, retak', icon: '🛣️' },
  { code: 'lampu_mati', name: 'Lampu Mati', description: 'Penerangan jalan umum mati', icon: '💡' },
  { code: 'sampah', name: 'Sampah', description: 'Masalah sampah menumpuk', icon: '🗑️' },
  { code: 'drainase', name: 'Drainase', description: 'Saluran air tersumbat/rusak', icon: '🌊' },
  { code: 'pohon_tumbang', name: 'Pohon Tumbang', description: 'Pohon tumbang/berbahaya', icon: '🌳' },
  { code: 'fasilitas_rusak', name: 'Fasilitas Rusak', description: 'Kerusakan fasilitas umum', icon: '🏗️' },
];

const resolvers = {
  Query: {
    services: async () => {
      // Always use config-based services (they're the source of truth)
      // Database is optional for storing additional state like is_active
      try {
        const dbServices = await reservationService.getActiveServices();
        const dbServiceMap = new Map(dbServices.map((s: any) => [s.code, s]));

        // Return config services merged with any database overrides
        return GOVERNMENT_SERVICES.map(configService => {
          const dbService = dbServiceMap.get(configService.code);
          return {
            ...configService,
            is_active: dbService?.is_active ?? true,
            is_online_available: dbService?.is_online_available ?? true,
            all_questions: getQuestionsForService(configService.code),
          };
        });
      } catch (error) {
        logger.error('Error fetching services from DB, using config only:', error);
        // Fallback to config-based services
        return GOVERNMENT_SERVICES.map(s => ({
          ...s,
          is_active: true,
          is_online_available: true,
          all_questions: getQuestionsForService(s.code),
        }));
      }
    },

    service: async (_: any, { code }: { code: string }) => {
      try {
        const dbService = await reservationService.getServiceByCodeFromDb(code);
        const configService = getServiceByCode(code);

        if (!dbService && !configService) return null;

        return {
          ...configService,
          ...dbService,
          citizen_questions: configService?.citizen_questions || [],
          all_questions: getQuestionsForService(code),
        };
      } catch (error) {
        logger.error('Error fetching service:', error);
        const configService = getServiceByCode(code);
        if (!configService) return null;
        return {
          ...configService,
          is_active: true,
          is_online_available: true,
          all_questions: getQuestionsForService(code),
        };
      }
    },

    availableSlots: async (_: any, { serviceCode, date }: { serviceCode: string; date: string }) => {
      try {
        const result = await reservationService.getAvailableSlots(serviceCode, new Date(date));
        return result;
      } catch (error) {
        logger.error('Error fetching available slots:', error);
        throw new Error('Failed to fetch available slots');
      }
    },

    complaintCategories: () => COMPLAINT_CATEGORIES,
  },

  Mutation: {
    createComplaint: async (_: any, { input }: { input: any }) => {
      try {
        // Generate a web user ID for tracking
        const webUserId = `web_form_${Date.now()}`;

        // Add reporter info to description
        const fullDescription = `${input.deskripsi}\n\n---\nPelapor: ${input.nama_pelapor}\nNo. HP: ${input.no_hp}`;

        const complaint = await complaintService.createComplaint({
          wa_user_id: webUserId,
          kategori: input.kategori,
          deskripsi: fullDescription,
          alamat: input.alamat,
          rt_rw: input.rt_rw,
          foto_url: input.foto_url,
        });

        return {
          success: true,
          complaint_id: complaint.complaint_id,
          message: `Laporan berhasil dibuat dengan ID: ${complaint.complaint_id}`,
        };
      } catch (error: any) {
        logger.error('Error creating complaint:', error);
        return {
          success: false,
          error: error.message || 'Gagal membuat laporan',
        };
      }
    },

    createReservation: async (_: any, { input }: { input: any }) => {
      try {
        // Generate a web user ID for tracking
        const webUserId = `web_form_${Date.now()}`;

        // Parse additional data if provided
        let additionalData = {};
        if (input.additional_data) {
          try {
            additionalData = JSON.parse(input.additional_data);
          } catch (e) {
            // Ignore parse errors
          }
        }

        const citizenData = {
          nama_lengkap: input.nama_lengkap,
          nik: input.nik,
          alamat: input.alamat,
          no_hp: input.no_hp,
          ...additionalData,
        };

        const reservation = await reservationService.createReservation({
          wa_user_id: webUserId,
          service_code: input.service_code,
          citizen_data: citizenData,
          reservation_date: new Date(input.reservation_date),
          reservation_time: input.reservation_time,
        });

        return {
          success: true,
          reservation_id: reservation.reservation_id,
          queue_number: reservation.queue_number,
          message: `Reservasi berhasil! ID: ${reservation.reservation_id}, Nomor Antrian: ${reservation.queue_number}`,
        };
      } catch (error: any) {
        logger.error('Error creating reservation:', error);
        return {
          success: false,
          error: error.message || 'Gagal membuat reservasi',
        };
      }
    },
  },
};

// ==================== CREATE ROUTER ====================

export async function createGraphQLRouter(): Promise<Router> {
  const router = Router();

  const server = new ApolloServer<BaseContext>({
    typeDefs,
    resolvers,
    introspection: true, // Enable GraphQL Playground
  });

  await server.start();

  // Manual GraphQL handling for Express
  router.use('/', cors(), json());

  router.post('/', async (req: Request, res: Response) => {
    try {
      const { query, variables, operationName } = req.body;

      const result = await server.executeOperation({
        query,
        variables,
        operationName,
      });

      if (result.body.kind === 'single') {
        res.json(result.body.singleResult);
      } else {
        res.json({ errors: [{ message: 'Incremental delivery not supported' }] });
      }
    } catch (error: any) {
      logger.error('GraphQL execution error:', error);
      res.status(500).json({
        errors: [{ message: error.message || 'Internal server error' }]
      });
    }
  });

  // GET for GraphQL Playground/introspection
  router.get('/', (req: Request, res: Response) => {
    res.send(`
      <!DOCTYPE html>
      <html>
        <head>
          <title>GovConnect GraphQL API</title>
          <style>
            body { font-family: system-ui, sans-serif; max-width: 800px; margin: 50px auto; padding: 20px; }
            h1 { color: #333; }
            code { background: #f4f4f4; padding: 2px 6px; border-radius: 4px; }
            pre { background: #f4f4f4; padding: 15px; border-radius: 8px; overflow-x: auto; }
          </style>
        </head>
        <body>
          <h1>🏛️ GovConnect GraphQL API</h1>
          <p>This is the GraphQL endpoint for public form submissions.</p>
          <h3>Available Operations:</h3>
          <ul>
            <li><strong>Query: services</strong> - Get all government services</li>
            <li><strong>Query: service(code)</strong> - Get a specific service</li>
            <li><strong>Query: availableSlots(serviceCode, date)</strong> - Get available time slots</li>
            <li><strong>Query: complaintCategories</strong> - Get complaint categories</li>
            <li><strong>Mutation: createComplaint</strong> - Submit a complaint</li>
            <li><strong>Mutation: createReservation</strong> - Create a reservation</li>
          </ul>
          <h3>Example Query:</h3>
          <pre>
curl -X POST ${req.protocol}://${req.get('host')}/graphql \\
  -H "Content-Type: application/json" \\
  -d '{"query": "{ services { code name category } }"}'
          </pre>
        </body>
      </html>
    `);
  });

  logger.info('GraphQL server initialized at /graphql');

  return router;
}

export { typeDefs, resolvers };

