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
ENV DATABASE_URL="postgresql://postgres:postgres@localhost:5432/dummy?schema=channel"
RUN pnpm prisma generate

# Build TypeScript
RUN pnpm build

# ===============================================
# STAGE 3: Runner
# ===============================================
FROM node:22-alpine AS runner

WORKDIR /app

ENV NODE_ENV=production

# Create non-root user
RUN addgroup --system --gid 1001 nodejs && \
    adduser --system --uid 1001 channeluser

# Copy runtime artifacts and local Prisma CLI from builder so startup does not
# depend on registry access.
COPY --from=builder /app/package.json ./package.json
COPY --from=builder /app/prisma ./prisma
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/dist ./dist

# Create uploads directory
RUN mkdir -p uploads && chown -R channeluser:nodejs /app

USER channeluser

EXPOSE 3001

# Create entrypoint script with auto-migration (pin Prisma CLI to match @prisma/client version)
RUN echo '#!/bin/sh' > /app/entrypoint.sh && \
    echo 'set -e' >> /app/entrypoint.sh && \
    echo 'echo "🔄 Running database migrations..."' >> /app/entrypoint.sh && \
    echo 'if [ -n "$DATABASE_URL" ]; then' >> /app/entrypoint.sh && \
    echo '  if [ -d prisma/migrations ] && [ "$(ls -A prisma/migrations 2>/dev/null)" ]; then' >> /app/entrypoint.sh && \
    echo '    echo "📦 Running migrate deploy..."' >> /app/entrypoint.sh && \
    echo '    ./node_modules/.bin/prisma migrate deploy' >> /app/entrypoint.sh && \
    echo '  else' >> /app/entrypoint.sh && \
    echo '    echo "❌ Prisma migrations missing from image; refusing to start"' >> /app/entrypoint.sh && \
    echo '    exit 1' >> /app/entrypoint.sh && \
    echo '  fi' >> /app/entrypoint.sh && \
    echo 'else' >> /app/entrypoint.sh && \
    echo '  echo "❌ DATABASE_URL not set; refusing to start without migrations"' >> /app/entrypoint.sh && \
    echo '  exit 1' >> /app/entrypoint.sh && \
    echo 'fi' >> /app/entrypoint.sh && \
    echo 'echo "✅ Database ready"' >> /app/entrypoint.sh && \
    echo 'echo "🚀 Starting Channel Service..."' >> /app/entrypoint.sh && \
    echo 'exec node dist/server.js' >> /app/entrypoint.sh && \
    chmod +x /app/entrypoint.sh

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=40s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://localhost:3001/health || exit 1

# Start with entrypoint
CMD ["/app/entrypoint.sh"]
