# GovConnect Channel Service

<!-- CI/CD Trigger: 2026-02-01-v2 - Prisma client fix -->

## OverviewS

Channel Service handles communication channels for the GovConnect platform, including:
- WhatsApp message handling
- Webchat support
- Live chat admin interface

## Features

- 📱 WhatsApp API integration
- 💬 Real-time messaging via WebSocket
- 👥 Admin takeover functionality
- 📊 Conversation management
- 🔄 Message history

## Tech Stack

- **Runtime**: Node.js 22
- **Framework**: Express.js + TypeScript
- **Database**: PostgreSQL with Prisma ORM
- **Message Broker**: RabbitMQ

## Ports

- **Container Port**: 3001
- **Host Port**: 3001

## Environment Variables

See `.env.example` for required configuration.

## Local Development

```bash
# Install dependencies
pnpm install

# Generate Prisma client
pnpm prisma generate

# Run development server
pnpm dev
```

## Docker

```bash
# Build locally
docker compose up -d --build

# Production (using pre-built image)
export IMAGE_CHANNEL=ghcr.io/mygads/govconnect-channel-service:latest
docker compose up -d
```

## Health Check

```bash
curl http://localhost:3001/health
```

---

> Last updated: 2026-02-01 - CI/CD trigger for rebuild
