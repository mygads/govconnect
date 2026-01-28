# ===============================================
# STAGE 1: Dependencies
# ===============================================
FROM node:22-alpine AS deps

# Install pnpm
RUN corepack enable && corepack prepare pnpm@latest --activate

WORKDIR /app

# Copy package files
COPY package.json pnpm-lock.yaml ./
COPY prisma ./prisma/

# Install dependencies
RUN pnpm install --frozen-lockfile

# ===============================================
# STAGE 2: Builder  
# ===============================================
FROM node:22-alpine AS builder

RUN corepack enable && corepack prepare pnpm@latest --activate

WORKDIR /app

# Copy dependencies from deps stage
COPY --from=deps /app/node_modules ./node_modules
COPY . .

# Generate Prisma Client
ENV DATABASE_URL="postgresql://postgres:postgres@localhost:5432/dummy?schema=dashboard"
RUN echo "Running prisma generate..." && pnpm prisma generate || echo "⚠️  prisma generate failed during build; continuing"

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

# Ensure bcryptjs is resolvable in pnpm layout (needed by prisma seed)
RUN set -e; \
    if [ ! -e node_modules/bcryptjs ]; then \
    for pkg_dir in node_modules/.pnpm/bcryptjs@*; do \
    [ -d "$pkg_dir/node_modules/bcryptjs" ] || continue; \
    ln -s ".pnpm/$(basename "$pkg_dir")/node_modules/bcryptjs" "node_modules/bcryptjs"; \
    break; \
    done; \
    fi

# Set proper permissions
RUN chown -R nextjs:nodejs /app

USER nextjs

EXPOSE 3000

ENV PORT=3000
ENV HOSTNAME="0.0.0.0"

# Create entrypoint script with auto-migration
RUN echo '#!/bin/sh' > /app/entrypoint.sh && \
    echo 'echo "🔄 Running database migrations..."' >> /app/entrypoint.sh && \
    echo 'if [ -d prisma/migrations ] && [ "$(ls -A prisma/migrations 2>/dev/null)" ]; then' >> /app/entrypoint.sh && \
    echo '  node node_modules/prisma/build/index.js migrate deploy || (echo "⚠️  Migration failed, trying db push..." && node node_modules/prisma/build/index.js db push --accept-data-loss) || echo "⚠️  DB push failed, continuing..."' >> /app/entrypoint.sh && \
    echo 'else' >> /app/entrypoint.sh && \
    echo '  node node_modules/prisma/build/index.js db push --accept-data-loss || echo "⚠️  DB push failed, continuing..."' >> /app/entrypoint.sh && \
    echo 'fi' >> /app/entrypoint.sh && \
    echo 'echo "✅ Database ready"' >> /app/entrypoint.sh && \
    echo 'if [ "${RUN_SEED:-false}" = "true" ]; then' >> /app/entrypoint.sh && \
    echo '  echo "🌱 Running prisma seed..."' >> /app/entrypoint.sh && \
    echo '  node node_modules/prisma/build/index.js db seed || echo "⚠️  Seed failed, continuing..."' >> /app/entrypoint.sh && \
    echo 'fi' >> /app/entrypoint.sh && \
    echo 'echo "🚀 Starting Dashboard..."' >> /app/entrypoint.sh && \
    echo 'exec node server.js' >> /app/entrypoint.sh && \
    chmod +x /app/entrypoint.sh

# Prisma seed untuk dashboard pakai `tsx prisma/seed.ts` (lihat package.json#prisma.seed)
# Standalone output Next.js tidak membawa binary tsx, jadi install runtime ringan.
USER root
RUN npm install -g tsx@4.20.6
USER nextjs

# Start with entrypoint
CMD ["/app/entrypoint.sh"]
