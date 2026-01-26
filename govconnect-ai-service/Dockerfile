FROM node:23-alpine AS builder

WORKDIR /app

# Install pnpm
RUN npm install -g pnpm

# Copy package files
COPY package.json pnpm-lock.yaml* pnpm-workspace.yaml* tsconfig.json prisma.config.ts ./

# Install dependencies
RUN pnpm install

COPY prisma ./prisma
COPY src ./src

# Build TypeScript (provide dummy DATABASE_URL for prisma generate)
ENV DATABASE_URL="postgresql://dummy:dummy@localhost:5432/dummy"
RUN pnpm run build

# Production stage
FROM node:23-alpine

WORKDIR /app

# Install CA certificates for outbound HTTPS (Gemini API)
RUN apk add --no-cache ca-certificates && update-ca-certificates

RUN npm install -g pnpm

# Copy package files
COPY package.json pnpm-lock.yaml* ./

# Install production dependencies only
RUN pnpm install --prod

# Copy prisma schema
COPY prisma ./prisma

# Generate Prisma Client
RUN pnpm prisma generate

# Copy built files from builder
COPY --from=builder /app/dist ./dist

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
    echo 'exec node dist/server.js' >> /app/entrypoint.sh && \
    chmod +x /app/entrypoint.sh

# Start with entrypoint
CMD ["/app/entrypoint.sh"]
