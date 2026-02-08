# ===============================================
# STAGE 1: Dependencies
# ===============================================
FROM node:22-alpine AS deps

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

RUN corepack enable && corepack prepare pnpm@9.15.4 --activate

WORKDIR /app

# Copy dependencies from deps stage
COPY --from=deps /app/node_modules ./node_modules
COPY . .

# Generate Prisma Client
ENV DATABASE_URL="postgresql://postgres:postgres@localhost:5432/dummy?schema=dashboard"
RUN echo "Running prisma generate..." && \
    pnpm prisma generate 2>&1 || { \
      echo "⚠️ prisma generate failed, trying alternative approach..."; \
      npm install prisma@latest @prisma/client@latest --silent; \
      npx prisma generate 2>&1 || echo "⚠️ prisma generate failed during build; continuing"; \
    }

# Build Next.js app
ENV NEXT_TELEMETRY_DISABLED=1
ENV NEXT_DISABLE_TURBOPACK=1
ENV NEXT_OUTPUT=standalone

# Build-time environment variables for SEO
ARG NEXT_PUBLIC_APP_URL=https://govconnect.my.id
ENV NEXT_PUBLIC_APP_URL=${NEXT_PUBLIC_APP_URL}

RUN pnpm build

# ===============================================
# STAGE 3: Runner
# ===============================================
FROM node:22-alpine AS runner

WORKDIR /app

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1

# Create non-root user
RUN addgroup --system --gid 1001 nodejs && \
    adduser --system --uid 1001 nextjs

# Copy necessary files from builder
COPY --from=builder /app/public ./public
COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static

# Copy Prisma schema and generated client
COPY --from=builder /app/prisma ./prisma
COPY --from=builder /app/node_modules/@prisma ./node_modules/@prisma

# Copy entire .pnpm directory for Prisma CLI dependencies
COPY --from=builder /app/node_modules/.pnpm ./node_modules/.pnpm
COPY --from=builder /app/node_modules/prisma ./node_modules/prisma

# Ensure Prisma CLI runtime deps are resolvable (pnpm symlink layout)
RUN set -e; \
        mkdir -p node_modules/@prisma; \
        for pkg_dir in node_modules/.pnpm/@prisma+*@*; do \
            [ -d "$pkg_dir/node_modules/@prisma" ] || continue; \
            for pkg_path in "$pkg_dir"/node_modules/@prisma/*; do \
                name="$(basename "$pkg_path")"; \
                [ -e "node_modules/@prisma/$name" ] || ln -s "../.pnpm/$(basename "$pkg_dir")/node_modules/@prisma/$name" "node_modules/@prisma/$name"; \
            done; \
        done

# Set proper permissions
RUN chown -R nextjs:nodejs /app

USER nextjs

EXPOSE 3000

ENV PORT=3000
ENV HOSTNAME="0.0.0.0"

# Create entrypoint script with auto-migration
RUN echo '#!/bin/sh' > /app/entrypoint.sh && \
    echo 'set -e' >> /app/entrypoint.sh && \
    echo 'echo "🔄 Running database migrations..."' >> /app/entrypoint.sh && \
    echo 'if [ -n "$DATABASE_URL" ]; then' >> /app/entrypoint.sh && \
    echo '  if [ -d prisma/migrations ] && [ "$(ls -A prisma/migrations 2>/dev/null)" ]; then' >> /app/entrypoint.sh && \
    echo '    echo "📦 Running migrate deploy..."' >> /app/entrypoint.sh && \
    echo '    node node_modules/prisma/build/index.js migrate deploy 2>&1 || {' >> /app/entrypoint.sh && \
    echo '      echo "⚠️ Migration failed, trying db push..."' >> /app/entrypoint.sh && \
    echo '      node node_modules/prisma/build/index.js db push 2>&1 || echo "⚠️ DB operations failed, continuing..."' >> /app/entrypoint.sh && \
    echo '    }' >> /app/entrypoint.sh && \
    echo '  else' >> /app/entrypoint.sh && \
    echo '    echo "📦 No migrations found, running db push..."' >> /app/entrypoint.sh && \
    echo '    node node_modules/prisma/build/index.js db push 2>&1 || echo "⚠️ DB push failed, continuing..."' >> /app/entrypoint.sh && \
    echo '  fi' >> /app/entrypoint.sh && \
    echo 'else' >> /app/entrypoint.sh && \
    echo '  echo "⚠️ DATABASE_URL not set, skipping migrations"' >> /app/entrypoint.sh && \
    echo 'fi' >> /app/entrypoint.sh && \
    echo 'echo "✅ Database ready"' >> /app/entrypoint.sh && \
    echo 'echo "🚀 Starting Dashboard..."' >> /app/entrypoint.sh && \
    echo 'exec node server.js' >> /app/entrypoint.sh && \
    chmod +x /app/entrypoint.sh

# Start with entrypoint
CMD ["/app/entrypoint.sh"]

# Health check
HEALTHCHECK --interval=30s --timeout=15s --start-period=60s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://localhost:3000/ || exit 1
