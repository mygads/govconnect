import { PrismaClient } from '@prisma/client';
import logger from '../utils/logger';

const prisma = new PrismaClient({
  log: [
    { level: 'query', emit: 'event' },
    { level: 'error', emit: 'event' },
    { level: 'warn', emit: 'event' },
  ],
});

// Log queries in development
if (process.env.NODE_ENV === 'development') {
  prisma.$on('query', (e: any) => {
    logger.debug('Query', { query: e.query, params: e.params, duration: e.duration });
  });
}

prisma.$on('error', (e: any) => {
  logger.error('Database error', { message: e.message });
});

prisma.$on('warn', (e: any) => {
  logger.warn('Database warning', { message: e.message });
});

// Test connection on startup
async function testConnection() {
  try {
    await prisma.$connect();
    logger.info('✅ Database connected successfully');
  } catch (error: any) {
    logger.error('❌ Database connection failed', { error: error.message });
    throw error;
  }
}

testConnection();

export default prisma;
