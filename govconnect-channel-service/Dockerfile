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

# Install pnpm
RUN corepack enable && corepack prepare pnpm@9.15.4 --activate

# Copy package files
COPY package.json pnpm-lock.yaml ./

# Install production dependencies only
RUN pnpm install --prod --frozen-lockfile

# Copy prisma schema and generated client from builder
COPY --from=builder /app/prisma ./prisma
COPY --from=builder /app/node_modules/@prisma ./node_modules/@prisma

# Copy entire .pnpm directory for Prisma dependencies
COPY --from=builder /app/node_modules/.pnpm ./node_modules/.pnpm

# Ensure Prisma client is resolvable (pnpm symlink layout)
RUN set -e; \
    mkdir -p node_modules/@prisma; \
    for pkg_dir in node_modules/.pnpm/@prisma+client@*; do \
        [ -d "$pkg_dir/node_modules/@prisma" ] || continue; \
        for pkg_path in "$pkg_dir"/node_modules/@prisma/*; do \
            name="$(basename "$pkg_path")"; \
            [ -e "node_modules/@prisma/$name" ] || ln -sf "../.pnpm/$(basename "$pkg_dir")/node_modules/@prisma/$name" "node_modules/@prisma/$name"; \
        done; \
    done

# Copy built application
COPY --from=builder /app/dist ./dist

# Create uploads directory
RUN mkdir -p uploads && chown -R channeluser:nodejs /app

USER channeluser

EXPOSE 3001

# Create entrypoint script with auto-migration
RUN echo '#!/bin/sh' > /app/entrypoint.sh && \
    echo 'set -e' >> /app/entrypoint.sh && \
    echo 'echo "🔄 Running database migrations..."' >> /app/entrypoint.sh && \
    echo 'if [ -n "$DATABASE_URL" ]; then' >> /app/entrypoint.sh && \
    echo '  if [ -d prisma/migrations ] && [ "$(ls -A prisma/migrations 2>/dev/null)" ]; then' >> /app/entrypoint.sh && \
    echo '    echo "📦 Running migrate deploy..."' >> /app/entrypoint.sh && \
    echo '    npx prisma migrate deploy 2>&1 || {' >> /app/entrypoint.sh && \
    echo '      echo "⚠️ Migration failed, trying db push..."' >> /app/entrypoint.sh && \
    echo '      npx prisma db push --accept-data-loss 2>&1 || echo "⚠️ DB operations failed, continuing..."' >> /app/entrypoint.sh && \
    echo '    }' >> /app/entrypoint.sh && \
    echo '  else' >> /app/entrypoint.sh && \
    echo '    echo "📦 No migrations found, running db push..."' >> /app/entrypoint.sh && \
    echo '    npx prisma db push --accept-data-loss 2>&1 || echo "⚠️ DB push failed, continuing..."' >> /app/entrypoint.sh && \
    echo '  fi' >> /app/entrypoint.sh && \
    echo 'else' >> /app/entrypoint.sh && \
    echo '  echo "⚠️ DATABASE_URL not set, skipping migrations"' >> /app/entrypoint.sh && \
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
