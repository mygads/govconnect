# 🟩 GovConnect - AI-Powered Government Services Platform

Sistem layanan pemerintah berbasis WhatsApp dengan AI orchestrator untuk menangani laporan warga dan tiket pelayanan.

## 🏗️ Architecture

GovConnect menggunakan **microservices architecture** dengan 5 services utama:

```
┌─────────────┐
│  WhatsApp   │
└──────┬──────┘
       │
       ▼
┌─────────────────────────────────────────────┐
│  Service 1: Channel Service (Port 3001)     │
│  - Webhook handler                          │
│  - FIFO 30 messages storage                 │
│  - WhatsApp sender                          │
└──────┬──────────────────────────────────────┘
       │ (RabbitMQ Events)
       ▼
┌─────────────────────────────────────────────┐
│  Service 2: AI Orchestrator (Port 3002)     │
│  - LLM integration (Gemini)                 │
│  - Intent detection                         │
│  - Context builder                          │
│  - STATELESS (no database)                  │
└──────┬──────────────────────────────────────┘
       │ (SYNC REST API)
       ▼
┌─────────────────────────────────────────────┐
│  Service 3: Case Service (Port 3003)        │
│  - Laporan management                       │
│  - Tiket management                         │
│  - REST API for Dashboard                   │
└──────┬──────────────────────────────────────┘
       │ (RabbitMQ Events)
       ▼
┌─────────────────────────────────────────────┐
│  Service 5: Notification Service (Port 3004)│
│  - Send notifications via Service 1         │
│  - Template builder                         │
│  - Notification logs                        │
└─────────────────────────────────────────────┘

┌─────────────────────────────────────────────┐
│  Service 4: Dashboard (Port 3000)           │
│  - Admin panel (Next.js)                    │
│  - Manage laporan & tiket                   │
│  - Statistics & charts                      │
└─────────────────────────────────────────────┘
```

## 🚀 Quick Start

### Prerequisites

- Node.js 18+ & pnpm
- Docker & Docker Compose
- PostgreSQL client tools (optional)

### 1. Clone & Setup

```bash
cd govconnect
cp .env.example .env
# Edit .env with your credentials
```

### 2. Start Infrastructure

```bash
# Start PostgreSQL & RabbitMQ
docker-compose up -d

# Check status
docker-compose ps

# View logs
docker-compose logs -f
```

### 3. Verify Setup

**PostgreSQL Database:**
```bash
# Connect to database
docker exec -it govconnect-postgres psql -U postgres -d govconnect

# Test query
SELECT * FROM health_check();

# List all schemas
\dn

# Switch to channel schema
SET search_path TO channel;
```

**RabbitMQ Management:**
- URL: http://localhost:15672
- Login: `admin` / `rabbitmq_secret_2025`

### 4. Stop Infrastructure

```bash
# Stop containers
docker-compose down

# Stop and remove volumes (CAUTION: deletes all data)
docker-compose down -v
```

## 📊 Database Schema

**Single PostgreSQL instance** dengan schema terpisah per service:

| Service | Schema | Connection String (Windows Host) |
|---------|--------|----------------------------------|
| Channel | `channel` | `postgresql://postgres:postgres_secret_2025@localhost:5433/govconnect?schema=channel` |
| Case | `cases` | `postgresql://postgres:postgres_secret_2025@localhost:5433/govconnect?schema=cases` |
| Notification | `notification` | `postgresql://postgres:postgres_secret_2025@localhost:5433/govconnect?schema=notification` |
| Dashboard | `dashboard` | `postgresql://postgres:postgres_secret_2025@localhost:5433/govconnect?schema=dashboard` |
| Testing | `testing` | `postgresql://postgres:postgres_secret_2025@localhost:5433/govconnect?schema=testing` |

**PostgreSQL Ports**:
- **Windows Host**: `5433` (to avoid conflict with native PostgreSQL on port 5432)
- **Docker Network**: `5432` (internal)

**Container**: `govconnect-postgres`

**Important**: Services running in Docker use `postgres:5432`, services running on Windows host use `localhost:5433`

## 🐰 RabbitMQ

- AMQP Port: `5672`
- Management UI: `15672`
- Exchange: `govconnect.events` (type: topic)

## 📁 Project Structure

```
govconnect/
├── docker/                          # Docker configs
│   ├── init-databases.sql
│   ├── rabbitmq.conf
│   └── definitions.json
├── docs/                            # Documentation
├── phases/                          # Development phase plans
├── govconnect-channel-service/      # Service 1
├── govconnect-ai-service/           # Service 2
├── govconnect-case-service/         # Service 3
├── govconnect-notification-service/ # Service 4
├── govconnect-dashboard/            # Service 5
├── docker-compose.yml
├── .env.example
└── README.md
```

## 📚 Development Phases

Ikuti development phases secara berurutan:

- [x] **Phase 0**: Infrastructure Setup (CURRENT)
- [ ] **Phase 1**: Channel Service
- [ ] **Phase 2**: AI Orchestrator
- [ ] **Phase 3**: Case Service
- [ ] **Phase 4**: Notification Service
- [ ] **Phase 5**: Dashboard
- [ ] **Phase 6**: Integration & Testing
- [ ] **Phase 7**: Deployment

Lihat detail: [GOVCONNECT_DEV_PHASES.md](./GOVCONNECT_DEV_PHASES.md)

## 🔐 Security Notes

- **NEVER** commit `.env` files to git
- Change default passwords in production
- Generate strong secrets:
  ```bash
  # JWT Secret
  openssl rand -base64 32
  
  # Internal API Key
  openssl rand -base64 64
  ```

## 🧪 Testing

```bash
# Test database connection from Windows host
$env:PGPASSWORD="postgres_secret_2025"
psql -h localhost -p 5433 -U postgres -d govconnect -c "SELECT * FROM health_check();"

# Test from inside container
docker exec -it govconnect-postgres psql -U postgres -d govconnect -c "SELECT * FROM health_check();"

# List all schemas
docker exec -it govconnect-postgres psql -U postgres -d govconnect -c "\dn"

# Test RabbitMQ
docker exec govconnect-rabbitmq rabbitmq-diagnostics status

# List exchanges
docker exec govconnect-rabbitmq rabbitmqctl list_exchanges -p govconnect
```

**Note**: For comprehensive testing guide, see [docs/database-testing-guide.md](./docs/database-testing-guide.md)

## 📞 Support

- Instructions: [.github/instructions/govconnect.instructions.md](../.github/instructions/govconnect.instructions.md)
- Development Plan: [GOVCONNECT_DEV_PHASES.md](./GOVCONNECT_DEV_PHASES.md)

## 📝 License

Internal project for government services.

---

**Status**: Phase 0 Complete ✅  
**Last Updated**: November 25, 2025  
**PostgreSQL Port**: 5433 (Windows Host) / 5432 (Docker Internal)
