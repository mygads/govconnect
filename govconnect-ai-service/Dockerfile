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

# Install OpenSSL for Prisma
RUN apk add --no-cache openssl

WORKDIR /app

ENV NODE_ENV=production

# Create non-root user
RUN addgroup --system --gid 1001 nodejs && \
    adduser --system --uid 1001 aiuser

# Copy runtime artifacts and local Prisma CLI from builder so startup stays
# deterministic even when the npm registry is unavailable.
COPY --from=builder /app/package.json ./package.json
COPY --from=builder /app/prisma ./prisma
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/dist ./dist

# Create required directories with proper permissions
RUN mkdir -p logs uploads/documents data && chown -R aiuser:nodejs /app

EXPOSE 3002

# Create entrypoint script — runs as root to fix volume permissions, then drops to aiuser
RUN echo '#!/bin/sh' > /app/entrypoint.sh && \
    echo 'set -e' >> /app/entrypoint.sh && \
    echo '' >> /app/entrypoint.sh && \
    echo '# Fix volume permissions (Docker volumes mount as root)' >> /app/entrypoint.sh && \
    echo 'mkdir -p /app/uploads/documents /app/data /app/logs' >> /app/entrypoint.sh && \
    echo 'chown -R aiuser:nodejs /app/uploads /app/data /app/logs 2>/dev/null || true' >> /app/entrypoint.sh && \
    echo '' >> /app/entrypoint.sh && \
    echo '# Ensure pgvector exists in schema ai before Prisma touches vector columns' >> /app/entrypoint.sh && \
    echo 'if [ -n "$DATABASE_URL" ]; then' >> /app/entrypoint.sh && \
    echo '  echo "🧩 Ensuring pgvector extension is available in schema ai..."' >> /app/entrypoint.sh && \
    echo '  printf "%s\n" "CREATE SCHEMA IF NOT EXISTS ai;" "CREATE EXTENSION IF NOT EXISTS vector SCHEMA ai;" | su -s /bin/sh aiuser -c "./node_modules/.bin/prisma db execute --stdin --schema prisma/schema.prisma 2>&1" || { echo "❌ pgvector bootstrap failed; install vector extension in schema ai before starting"; exit 1; }' >> /app/entrypoint.sh && \
    echo '  printf "%s\n" "DO \$sql\$ BEGIN IF EXISTS (SELECT 1 FROM pg_extension e JOIN pg_namespace n ON n.oid = e.extnamespace WHERE e.extname = \$v\$vector\$v\$ AND n.nspname <> \$v\$ai\$v\$ AND pg_get_userbyid(e.extowner) = current_user) THEN EXECUTE \$v\$ALTER EXTENSION vector SET SCHEMA ai\$v\$; END IF; END \$sql\$;" | su -s /bin/sh aiuser -c "./node_modules/.bin/prisma db execute --stdin --schema prisma/schema.prisma 2>&1" || { echo "❌ pgvector schema alignment failed"; exit 1; }' >> /app/entrypoint.sh && \
    echo 'fi' >> /app/entrypoint.sh && \
    echo '' >> /app/entrypoint.sh && \
    echo '# Migrations are run sequentially by CI/CD' >> /app/entrypoint.sh && \
    echo 'if [ ! -d prisma/migrations ] || [ ! "$(ls -A prisma/migrations 2>/dev/null)" ]; then' >> /app/entrypoint.sh && \
    echo '  echo "❌ Prisma migrations missing from image; refusing to start"' >> /app/entrypoint.sh && \
    echo '  exit 1' >> /app/entrypoint.sh && \
    echo 'fi' >> /app/entrypoint.sh && \
    echo 'echo "✅ Prisma migrations present"' >> /app/entrypoint.sh && \
    echo 'echo "🚀 Starting AI Service..."' >> /app/entrypoint.sh && \
    echo 'exec su -s /bin/sh aiuser -c "node dist/server.js"' >> /app/entrypoint.sh && \
    chmod +x /app/entrypoint.sh

# NOTE: Do NOT set USER aiuser — entrypoint runs as root to fix volume perms, then drops to aiuser

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=40s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://localhost:3002/health || exit 1

# Start with entrypoint
CMD ["/app/entrypoint.sh"]
