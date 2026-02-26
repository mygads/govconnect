# 🟩 Tanggapin AI - AI-Powered Government Services Platform

Sistem layanan pemerintah berbasis WhatsApp dengan AI orchestrator untuk menangani laporan warga dan permohonan layanan (form publik).

## 🏗️ Architecture

Tanggapin AI menggunakan **microservices architecture** dengan 5 services utama:

```
┌─────────────┐
│  WhatsApp   │
└──────┬──────┘
       │
       ▼
┌────────────────────────────────────────────┐
│   DIRECT SERVICE COMMUNICATION             │
│   (NO AGGREGATED API GATEWAY)              │
└──────┬─────────────────────────────────────┘
       │
       ├────────────────────────────────────────────┐
       ▼                                            ▼
┌─────────────────────────────┐   ┌─────────────────────────────┐
│  Service 1: Channel Service │   │  Service 4: Dashboard       │
│  Port: 3001                 │   │  Port: 3000                 │
│  - Webhook handler          │   │  - Admin panel (Next.js)    │
│  - FIFO 30 messages         │   │  - Kelola laporan &         │
│                             │   │    permohonan layanan       │
│  - WhatsApp sender          │   │  - Statistics & charts      │
└──────┬──────────────────────┘   └─────────────────────────────┘
       │ (RabbitMQ Events)
       ▼
┌─────────────────────────────┐
│  Service 2: AI Orchestrator │
│  Port: 3002                 │
│  - LLM integration (Gemini) │
│  - Intent detection         │
│  - Circuit Breaker          │
│  - STATELESS (no database)  │
└──────┬──────────────────────┘
       │ (SYNC REST API)
       ▼
┌─────────────────────────────┐
│  Service 3: Case Service    │
│  Port: 3003                 │
│  - Laporan management       │
│  - Permohonan layanan        │
│  - REST API for Dashboard   │
└──────┬──────────────────────┘
       │ (RabbitMQ Events)
       ▼
┌─────────────────────────────┐
│  Service 5: Notification    │
│  Port: 3004                 │
│  - Send via Service 1       │
│  - Template builder         │
│  - Notification logs        │
└─────────────────────────────┘
```

## ✅ Features Implemented

- [x] **5 Microservices** - Channel, AI, Case, Notification, Dashboard
- [x] **Database-per-Service** - Separate PostgreSQL databases for isolation
- [x] **RabbitMQ** - Async message broker for events
- [x] **REST APIs** - Sync communication between services
- [x] **Knowledge Base** - Profil desa + dokumen untuk jawaban AI
- [x] **Channel Connect** - Token & nomor WA per desa + toggle WA/Webchat
- [x] **Kubernetes Manifests** - Full K8s deployment ready
- [x] **OpenAPI Documentation** - Complete API docs
- [x] **Circuit Breaker** - Resilience with Opossum
- [x] **CI/CD Pipeline** - GitHub Actions + GHCR
- [x] **Monitoring** - Prometheus + Grafana + cAdvisor
- [x] **Logging** - Loki + Promtail

## 🚀 Quick Start

### Prerequisites

- Node.js 20+ & pnpm
- Docker & Docker Compose v2+
- PostgreSQL client tools (optional)

### 1. Clone & Setup

```bash
cd govconnect
cp .env.example .env
# Edit .env with your credentials
```

### 2. Start Services

```bash
# Core services + PostgreSQL + RabbitMQ
docker compose up -d

# With monitoring (Prometheus + Grafana)
docker compose --profile monitoring up -d

# With logging (Loki + Promtail)
docker compose --profile logging up -d

# Full production stack
docker compose --profile production up -d

# All profiles
docker compose --profile monitoring --profile logging --profile production up -d
```

### 3. Verify Setup

```bash
# Check all services
docker compose ps

# View logs
docker compose logs -f

# Test health endpoints
curl http://localhost:3001/health  # Channel Service
curl http://localhost:3002/health  # AI Service
curl http://localhost:3003/health  # Case Service
curl http://localhost:3004/health  # Notification Service
curl http://localhost:3000/api/health  # Dashboard
```

### 4. Access UIs

| Service | URL |
|---------|-----|
| Dashboard | http://localhost:3000 |
| RabbitMQ | http://localhost:15672 (admin/${RABBITMQ_PASSWORD}) |
| Grafana | http://localhost:3100 (admin/govconnect-grafana-2025) |
| Prometheus | http://localhost:9090 |

## 📊 Database

**Separate PostgreSQL databases** untuk setiap service yang menyimpan data (no schema needed, uses `public` by default):

| Service | Database | Description |
|---------|----------|-------------|
| Channel | `gc_channel` | Messages, send logs, conversations |
| Case | `gc_case` | Complaints, service requests |
| Notification | `gc_notification` | Notification logs, templates |
| Dashboard | `gc_dashboard` | Admin users, settings, knowledge base |
| AI Orchestrator | - | Stateless (no database) |

Connection string format:
```bash
# Standard format (no schema parameter needed)
DATABASE_URL=postgresql://postgres:password@postgres:5432/gc_{service}

# Examples:
DATABASE_URL=postgresql://postgres:postgres_secret_2025@postgres:5432/gc_channel
```

**Important Notes:**
- ✅ All services use `DATABASE_URL` environment variable
- ✅ No schema parameter in connection string (uses `public` by default)
- ✅ Each stateful service has its own database for isolation and scalability
- ✅ AI Orchestrator bersifat stateless (tanpa database)

### 🔄 Database Migrations (CI/CD Auto-Migrate)

Setiap service menggunakan **Prisma ORM** dan akan auto-migrate saat container start:

```
Container Start → Check migrations folder → Run migrate/push → Start Server
```

**Cara menambah/mengubah table:**

```bash
# 1. Masuk ke folder service
cd govconnect-channel-service

# 2. Edit schema.prisma
nano prisma/schema.prisma

# 3. Generate migration file (development)
pnpm prisma migrate dev --name add_new_table

# 4. Commit migration files ke Git
git add prisma/migrations/
git commit -m "feat: add new table"

# 5. Push ke main branch
git push origin main
# → CI/CD akan build image baru
# → Container restart akan menjalankan prisma migrate deploy
```

**Untuk perubahan cepat tanpa migration file:**
- Container akan otomatis menjalankan `prisma db push` jika tidak ada folder `migrations/`
- Ini cocok untuk development tapi tidak recommended untuk production

### AI Orchestrator (Stateless)

AI Orchestrator **tidak menggunakan database** dan tidak menyimpan data.

## 🐰 RabbitMQ Events

| Event | Producer | Consumer |
|-------|----------|----------|
| `whatsapp.message.received` | Channel | AI |
| `govconnect.ai.reply` | AI | Notification |
| `govconnect.complaint.created` | Case | Notification |
| `govconnect.service.requested` | Case | Notification |

## 📁 Project Structure

```
govconnect/
├── docker-compose.yml           # Unified Docker Compose
├── .env                         # Environment variables
├── docker/                      # Docker init scripts
├── k8s/                         # Kubernetes manifests
├── docs/                        # Documentation
│   ├── openapi/openapi.yaml    # API docs
│   └── SERVICE_ARCHITECTURE.md
├── phases/                      # Development phases
├── govconnect-channel-service/  # Service 1
├── govconnect-ai-service/       # Service 2
├── govconnect-case-service/     # Service 3
├── govconnect-dashboard/        # Service 4
├── govconnect-notification-service/ # Service 5
└── .github/workflows/ci-cd.yml  # CI/CD Pipeline
```

## 🚀 Deployment

### Docker Compose (VPS)

```bash
# Clone & configure
git clone <repo>
cd govconnect
cp .env.example .env
nano .env  # Configure for production

# Deploy services
docker compose --profile production up -d
```

### Kubernetes

```bash
cd k8s
./deploy.sh
```

## 🔧 Development

### Start Individual Service

```bash
cd govconnect-channel-service
pnpm install
pnpm prisma generate
pnpm prisma migrate deploy
pnpm dev
```

### Local Development Ports

| Service | Port |
|---------|------|
| Dashboard | 3000 |
| Channel | 3001 |
| AI | 3002 |
| Case | 3003 |
| Notification | 3004 |
| PostgreSQL | 5432 |
| RabbitMQ | 5672, 15672 |

## 🌐 Network Architecture

### Understanding Service Communication

GovConnect menggunakan **komunikasi langsung antar service** (tanpa gateway agregasi):

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                       INTERNAL NETWORK LAYER                                │
│                                                                             │
│                     (Docker Overlay Network)                                │
│                                                                             │
│   ┌──────────────┐        ┌──────────────┐        ┌──────────────┐         │
│   │   Dashboard  │───────▶│ Case Service │◀───────│  AI Service  │         │
│   │   :3000      │        │    :3003     │        │    :3002     │         │
│   └──────────────┘        └──────────────┘        └──────────────┘         │
│          │                       │                        │                 │
│          │                       │                        │                 │
│          ▼                       ▼                        ▼                 │
│   ┌──────────────┐        ┌──────────────┐        ┌──────────────┐         │
│   │   Channel    │◀───────│ Notification │        │   RabbitMQ   │         │
│   │   Service    │        │   Service    │        │    :5672     │         │
│   │    :3001     │        │    :3004     │        └──────────────┘         │
│   └──────────────┘        └──────────────┘                                 │
│                                                                             │
│   URL Pattern: http://service-name:port                                     │
└─────────────────────────────────────────────────────────────────────────────┘
```

### Environment URL Patterns

| Mode | Service URL Pattern | Example |
|------|---------------------|---------|
| **Local Dev (npm)** | `http://localhost:PORT` | `http://localhost:3003` |
| **Docker Compose** | `http://service-name:PORT` | `http://case-service:3003` |
| **Docker Swarm** | `http://service-name:PORT` | `http://case-service:3003` |
| **External Client** | `https://<service-domain>` | `https://case.govconnect.my.id` |

### Best Practice Rules

1. **Internal Service-to-Service**: Selalu gunakan Docker internal network (`http://service-name:port`).
       - Lebih cepat dan langsung
       - Tidak bergantung gateway agregasi

2. **External Client Access**: Akses masing-masing service langsung melalui domain publiknya.

3. **Dashboard (Next.js)**:
   - Browser → `/api/*` routes (Next.js API Routes)
   - Server-side → `http://service-name:port` (Direct internal)

4. **Webhook (WhatsApp)**: 
       - Masuk langsung ke Channel Service (domain publik channel)

## 📚 Documentation

- [Service Architecture](./docs/SERVICE_ARCHITECTURE.md)
- [Deployment Guide](./docs/DEPLOYMENT.md)
- [API Documentation](./docs/openapi/openapi.yaml)
- [Development Phases](./phases/DEVELOPMENT_PROGRESS.md)
- [Instructions](./.github/instructions/govconnect.instructions.md)
- **[Database Standardization](./DATABASE_STANDARDIZATION.md)** - Database configuration guide
- **[Migration Notes](./MIGRATION_NOTES.md)** - Detailed migration instructions
- **[Quick Reference](./QUICK_REFERENCE.md)** - Quick commands and troubleshooting

## 🔐 Security

- Change all default passwords in production
- Generate strong secrets:
  ```bash
  openssl rand -base64 32  # JWT Secret
  openssl rand -base64 64  # API Key
  ```
- Use HTTPS in production (SSL bisa dikelola oleh ingress/domain masing-masing service)

## 📝 License

Internal project - Tugas Besar EAI 2025

---

**Status**: ✅ ALL PHASES COMPLETE - READY FOR DEPLOYMENT  
**Domain**: govconnect.my.id  
**Last Updated**: January 2025
