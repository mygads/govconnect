import { PrismaClient } from '@prisma/client';

const isDev = process.env.NODE_ENV === 'development';

const prisma = new PrismaClient({
  log: isDev
    ? [
        { level: 'query', emit: 'event' },
        { level: 'error', emit: 'stdout' },
        { level: 'warn', emit: 'stdout' },
      ]
    : [{ level: 'error', emit: 'stdout' }],
});

// Log slow queries in development
if (isDev) {
  (prisma.$on as any)('query', (e: any) => {
    if (e.duration > 200) {
      console.warn(`[Prisma] Slow query (${e.duration}ms):`, e.query?.substring(0, 200));
    }
  });
}

export default prisma;
export { prisma };
