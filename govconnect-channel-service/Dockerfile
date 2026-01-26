FROM node:23-alpine

WORKDIR /app

# Install pnpm
RUN npm install -g pnpm@9

# Copy package files
COPY package.json ./

# Install ALL dependencies (including dev for tsx, typescript, etc)
RUN pnpm install --frozen-lockfile || pnpm install --no-frozen-lockfile

# Copy prisma schema
COPY prisma ./prisma/

# Generate Prisma Client
RUN pnpm prisma generate

# Copy source code
COPY . .

# Expose port
EXPOSE 3001

# Run migrations and start server
# Uses migrate deploy if migrations exist, otherwise db push
CMD ["sh", "-c", "if [ -d prisma/migrations ]; then pnpm prisma migrate deploy; else pnpm prisma db push --accept-data-loss; fi && pnpm dev"]
