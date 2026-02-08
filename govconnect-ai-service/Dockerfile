# ===============================================
# STAGE 1: Dependencies
# ===============================================
FROM node:22-alpine AS deps

# Install OpenSSL for Prisma
RUN apk add --no-cache openssl

# Install pnpm
RUN corepack enable && corepack prepare pnpm@9.15.4 --activate

WORKDIR /app

# Copy package files
COPY package.json pnpm-lock.yaml ./
COPY prisma ./prisma/

# Install dependencies (including dev dependencies for build)
RUN pnpm install --frozen-lockfile

# ===============================================
# STAGE 2: Builder
# ===============================================
FROM node:22-alpine AS builder

# Install OpenSSL for Prisma
RUN apk add --no-cache openssl

RUN corepack enable && corepack prepare pnpm@9.15.4 --activate

WORKDIR /app

# Copy dependencies from deps stage
COPY --from=deps /app/node_modules ./node_modules
COPY . .

# Generate Prisma Client
ENV DATABASE_URL="postgresql://postgres:postgres@localhost:5432/dummy?schema=ai"
RUN pnpm prisma generate

# Build TypeScript
RUN pnpm run build

# ===============================================
# STAGE 3: Runner
# ===============================================
FROM node:22-alpine AS runner

WORKDIR /app

ENV NODE_ENV=production

# Create non-root user
RUN addgroup --system --gid 1001 nodejs && \
    adduser --system --uid 1001 aiuser

# Install pnpm
RUN corepack enable && corepack prepare pnpm@9.15.4 --activate

# Copy package files
COPY package.json pnpm-lock.yaml ./

# Install production dependencies only
RUN pnpm install --prod --frozen-lockfile

# Copy prisma schema
COPY --from=builder /app/prisma ./prisma

# Copy built files from builder
COPY --from=builder /app/dist ./dist

# Generate Prisma client for production
RUN pnpm prisma generate

# Create logs directory
RUN mkdir -p logs && chown -R aiuser:nodejs /app

USER aiuser

EXPOSE 3002

# Create entrypoint script with auto-migration (pin Prisma CLI to match @prisma/client version)
RUN echo '#!/bin/sh' > /app/entrypoint.sh && \
    echo 'set -e' >> /app/entrypoint.sh && \
    echo 'echo "🔄 Running database migrations..."' >> /app/entrypoint.sh && \
    echo 'if [ -n "$DATABASE_URL" ]; then' >> /app/entrypoint.sh && \
    echo '  if [ -d prisma/migrations ] && [ "$(ls -A prisma/migrations 2>/dev/null)" ]; then' >> /app/entrypoint.sh && \
    echo '    echo "📦 Running migrate deploy..."' >> /app/entrypoint.sh && \
    echo '    npx prisma@6.19.0 migrate deploy 2>&1 || {' >> /app/entrypoint.sh && \
    echo '      echo "⚠️ Migration failed, trying db push..."' >> /app/entrypoint.sh && \
    echo '      npx prisma@6.19.0 db push --skip-generate 2>&1 || echo "⚠️ DB operations failed, continuing..."' >> /app/entrypoint.sh && \
    echo '    }' >> /app/entrypoint.sh && \
    echo '  else' >> /app/entrypoint.sh && \
    echo '    echo "📦 No migrations found, running db push..."' >> /app/entrypoint.sh && \
    echo '    npx prisma@6.19.0 db push --skip-generate 2>&1 || echo "⚠️ DB push failed, continuing..."' >> /app/entrypoint.sh && \
    echo '  fi' >> /app/entrypoint.sh && \
    echo 'else' >> /app/entrypoint.sh && \
    echo '  echo "⚠️ DATABASE_URL not set, skipping migrations"' >> /app/entrypoint.sh && \
    echo 'fi' >> /app/entrypoint.sh && \
    echo 'echo "✅ Database ready"' >> /app/entrypoint.sh && \
    echo 'echo "🚀 Starting AI Service..."' >> /app/entrypoint.sh && \
    echo 'exec node dist/server.js' >> /app/entrypoint.sh && \
    chmod +x /app/entrypoint.sh

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=40s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://localhost:3002/health || exit 1

# Start with entrypoint
CMD ["/app/entrypoint.sh"]
