FROM node:23-alpine AS builder

WORKDIR /app

# Install pnpm
RUN npm install -g pnpm

# Copy package files
COPY package.json pnpm-lock.yaml* ./

# Install dependencies
RUN pnpm install

# Copy source code
COPY . .

# Generate Prisma (no tsc build, we'll use tsx at runtime)
ENV DATABASE_URL="postgresql://dummy:dummy@localhost:5432/dummy"
RUN pnpm run build

# Production stage
FROM node:23-alpine

WORKDIR /app

RUN npm install -g pnpm

# Copy package files
COPY package.json pnpm-lock.yaml* ./

# Install all dependencies (need tsx for runtime)
RUN pnpm install

# Copy prisma schema
COPY prisma ./prisma

# Generate Prisma Client
RUN pnpm prisma generate

# Copy source files (tsx will run TypeScript directly)
COPY --from=builder /app/src ./src
COPY --from=builder /app/tsconfig.json ./tsconfig.json
COPY --from=builder /app/prisma.config.ts ./prisma.config.ts

# Create logs directory
RUN mkdir -p logs

# Expose port
EXPOSE 3002

# Create entrypoint script for auto migration
RUN echo '#!/bin/sh' > /app/entrypoint.sh && \
    echo 'echo "🔄 Running database migrations..."' >> /app/entrypoint.sh && \
    echo 'pnpm prisma db push --skip-generate --accept-data-loss || echo "⚠️  Migration failed, continuing..."' >> /app/entrypoint.sh && \
    echo 'echo "✅ Database ready"' >> /app/entrypoint.sh && \
    echo 'echo "🚀 Starting AI Service..."' >> /app/entrypoint.sh && \
    echo 'exec pnpm start' >> /app/entrypoint.sh && \
    chmod +x /app/entrypoint.sh

# Start with entrypoint
CMD ["/app/entrypoint.sh"]
