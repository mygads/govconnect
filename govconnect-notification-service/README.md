# GovConnect Notification Service

## Overview

Notification Service handles outbound notifications for the GovConnect platform:
- WhatsApp notifications
- Email notifications (future)
- SMS notifications (future)
- Push notifications (future)

## Features

- 📤 Send WhatsApp messages via API
- 📋 Notification templates
- 📊 Delivery status tracking
- 🔄 Retry mechanism for failed deliveries

## Tech Stack

- **Runtime**: Node.js 22
- **Framework**: Express.js + TypeScript
- **Database**: PostgreSQL with Prisma ORM
- **Message Broker**: RabbitMQ (consumer)

## Ports

- **Container Port**: 3004
- **Host Port**: 3004

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
export IMAGE_NOTIFICATION=ghcr.io/mygads/govconnect-notification-service:latest
docker compose up -d
```

## Health Check

```bash
curl http://localhost:3004/health
```

---

> Last updated: 2026-02-01 - CI/CD trigger for rebuild
