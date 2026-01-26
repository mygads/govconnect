# ============================================
# STAGE 1: Builder
# ============================================
FROM node:23-alpine AS builder

# Install OpenSSL for Prisma
RUN apk add --no-cache openssl

# Install pnpm
RUN npm install -g pnpm

WORKDIR /app

# Copy package files
COPY package.json ./

# Install dependencies
RUN pnpm install --frozen-lockfile || pnpm install --no-frozen-lockfile

# Copy source code
COPY . .

# Generate Prisma Client
RUN pnpm prisma generate

# Build TypeScript
RUN pnpm build

# ============================================
# STAGE 2: Production
# ============================================
FROM node:23-alpine

# Install OpenSSL for Prisma
RUN apk add --no-cache openssl

# Install pnpm
RUN npm install -g pnpm

WORKDIR /app

# Copy package files
COPY package.json ./

# Install production dependencies only
RUN pnpm install --prod --frozen-lockfile || pnpm install --prod --no-frozen-lockfile

# Install prisma as dev dependency for generate command
RUN pnpm add -D prisma@6.19.0

# Copy built files from builder
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/prisma ./prisma

# Generate Prisma Client in production
RUN pnpm prisma generate

# Create logs directory
RUN mkdir -p logs

# Expose port
EXPOSE 3004

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=40s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://localhost:3004/health || exit 1

# Run migrations and start application
# Uses migrate deploy if migrations exist, otherwise db push
CMD ["sh", "-c", "if [ -d prisma/migrations ]; then npx prisma migrate deploy; else npx prisma db push --accept-data-loss; fi && node dist/server.js"]
