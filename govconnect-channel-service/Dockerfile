FROM node:23-alpine

WORKDIR /app

# Install pnpm
RUN npm install -g pnpm@9

# Copy package files
COPY package.json pnpm-lock.yaml ./

# Install ALL dependencies (including dev for tsx, typescript, etc)
RUN pnpm install --frozen-lockfile

# Copy prisma schema
COPY prisma ./prisma/

# Generate Prisma Client
RUN pnpm prisma generate

# Copy source code
COPY . .

# Expose port
EXPOSE 3001

# Run migrations and start server
CMD ["sh", "-c", "pnpm prisma migrate deploy && pnpm dev"]
