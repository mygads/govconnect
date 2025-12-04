# PHASE 0: INFRASTRUCTURE SETUP

**Duration**: 2-3 jam  
**Complexity**: ⭐ Easy  
**Goal**: Setup database PostgreSQL, RabbitMQ, dan development tools

---

## 🎯 OBJECTIVES

- Setup PostgreSQL databases (5 databases)
- Setup RabbitMQ dengan management UI
- Setup Docker Compose untuk local development
- Prepare shared configuration & tools
- Setup git repository structure

---

## 📋 CHECKLIST

### 1. Git Repository Structure
- [x] Create main folder: `govconnect/`
- [x] Create subfolder untuk setiap service:
  - [x] `govconnect-channel-service/`
  - [x] `govconnect-ai-service/`
  - [x] `govconnect-case-service/`
  - [x] `govconnect-notification-service/`
  - [x] `govconnect-dashboard/`
- [x] Create `docker/` folder untuk docker configs
- [x] Create `docs/` folder untuk documentation
- [x] Create `.gitignore` (Node.js + PostgreSQL + RabbitMQ)

### 2. Docker Compose Setup
- [x] Create `docker-compose.yml` di root folder
- [x] Configure PostgreSQL services (1 instances 5 schema):
  - [x] `db-channel` → `gc_channel_db`
  - [x] `db-case`  → `gc_case_db`
  - [x] `db-notification` → `gc_notification_db`
  - [x] `db-dashboard`  → `gc_dashboard_db`
  - [x] `db-test` → `gc_test_db` (optional, untuk testing)
- [x] Configure RabbitMQ service:
  - [x] Port 5672 (AMQP)
  - [x] Port 15672 (Management UI)
  - [x] Default user: `admin` / `secret`
- [x] Configure volumes untuk data persistence
- [x] Configure networks untuk inter-container communication

### 3. Database Initialization
- [x] Create SQL init script `docker/init-databases.sql`
- [x] Create extensions jika perlu (uuid-ossp, pgcrypto)
- [x] Verify all databases created successfully
- [x] Test connections dari host machine

### 4. RabbitMQ Configuration
- [x] Start RabbitMQ container
- [x] Access management UI (http://localhost:15672)
- [x] Create exchange: `govconnect.events` (type: topic)
- [x] Create queues untuk testing (optional)
- [x] Verify exchange & queues working

### 5. Development Tools Setup
- [x] Install Node.js 18+ (✅ v23.4.0)
- [x] Install pnpm globally (✅ v9.11.0)
- [x] Install Docker Desktop (Windows) (✅ Running)
- [ ] Install Postman/Insomnia untuk API testing (optional)
- [ ] Install DBeaver/pgAdmin untuk database management (optional)

### 6. Environment Variables Template
- [x] Create `.env.example` dengan all variables
- [x] Document semua required environment variables
- [x] Create shared `.env` di root (untuk Docker Compose)

### 7. Testing & Verification
- [x] `docker-compose up -d` → all containers running
- [x] Connect ke semua PostgreSQL databases
- [x] Access RabbitMQ UI successfully
- [x] Ping between containers (network test)
- [ ] Test connections dari host machine

### 4. RabbitMQ Configuration
- [ ] Start RabbitMQ container
- [ ] Access management UI (http://localhost:15672)
- [ ] Create exchange: `govconnect.events` (type: topic)
- [ ] Create queues untuk testing:
  - [ ] `test.channel.queue`
  - [ ] `test.ai.queue`
- [ ] Verify exchange & queues working

### 5. Development Tools Setup
- [ ] Install Node.js 18+ (check: `node -v`)
- [ ] Install pnpm globally: `npm install -g pnpm`
- [ ] Install PostgreSQL client tools (psql)
- [ ] Install Docker Desktop (Windows)
- [ ] Install Postman/Insomnia untuk API testing
- [ ] Install DBeaver/pgAdmin untuk database management

### 6. Environment Variables Template
- [ ] Create `.env.example` untuk setiap service
- [ ] Document semua required environment variables
- [ ] Create shared `.env` di root (untuk Docker Compose)

### 7. Testing & Verification
- [ ] `docker-compose up -d` → all containers running
- [ ] Connect ke semua PostgreSQL databases
- [ ] Access RabbitMQ UI successfully
- [ ] Ping between containers (network test)

---

## 🐳 DOCKER COMPOSE FILE

Create `docker-compose.yml`:

```yaml
version: '3.8'

services:
  # ==================== DATABASES ====================
  
  # Database untuk Channel Service
  db-channel:
    image: postgres:15-alpine
    container_name: govconnect-db-channel
    environment:
      POSTGRES_DB: gc_channel_db
      POSTGRES_USER: postgres
      POSTGRES_PASSWORD: postgres_secret_2025
    ports:
      - "5432:5432"
    volumes:
      - pgdata-channel:/var/lib/postgresql/data
      - ./docker/init-databases.sql:/docker-entrypoint-initdb.d/init.sql
    networks:
      - govconnect-network
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U postgres"]
      interval: 10s
      timeout: 5s
      retries: 5

  # Database untuk Case Service
  db-case:
    image: postgres:15-alpine
    container_name: govconnect-db-case
    environment:
      POSTGRES_DB: gc_case_db
      POSTGRES_USER: postgres
      POSTGRES_PASSWORD: postgres_secret_2025
    ports:
      - "5433:5432"
    volumes:
      - pgdata-case:/var/lib/postgresql/data
    networks:
      - govconnect-network
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U postgres"]
      interval: 10s
      timeout: 5s
      retries: 5

  # Database untuk Notification Service
  db-notification:
    image: postgres:15-alpine
    container_name: govconnect-db-notification
    environment:
      POSTGRES_DB: gc_notification_db
      POSTGRES_USER: postgres
      POSTGRES_PASSWORD: postgres_secret_2025
    ports:
      - "5434:5432"
    volumes:
      - pgdata-notification:/var/lib/postgresql/data
    networks:
      - govconnect-network
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U postgres"]
      interval: 10s
      timeout: 5s
      retries: 5

  # Database untuk Dashboard
  db-dashboard:
    image: postgres:15-alpine
    container_name: govconnect-db-dashboard
    environment:
      POSTGRES_DB: gc_dashboard_db
      POSTGRES_USER: postgres
      POSTGRES_PASSWORD: postgres_secret_2025
    ports:
      - "5435:5432"
    volumes:
      - pgdata-dashboard:/var/lib/postgresql/data
    networks:
      - govconnect-network
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U postgres"]
      interval: 10s
      timeout: 5s
      retries: 5

  # Database untuk Testing (optional)
  db-test:
    image: postgres:15-alpine
    container_name: govconnect-db-test
    environment:
      POSTGRES_DB: gc_test_db
      POSTGRES_USER: postgres
      POSTGRES_PASSWORD: postgres_secret_2025
    ports:
      - "5436:5432"
    volumes:
      - pgdata-test:/var/lib/postgresql/data
    networks:
      - govconnect-network
    profiles:
      - testing

  # ==================== MESSAGE BROKER ====================
  
  rabbitmq:
    image: rabbitmq:3.12-management-alpine
    container_name: govconnect-rabbitmq
    environment:
      RABBITMQ_DEFAULT_USER: admin
      RABBITMQ_DEFAULT_PASS: rabbitmq_secret_2025
      RABBITMQ_DEFAULT_VHOST: govconnect
    ports:
      - "5672:5672"   # AMQP port
      - "15672:15672" # Management UI
    volumes:
      - rabbitmq-data:/var/lib/rabbitmq
      - ./docker/rabbitmq.conf:/etc/rabbitmq/rabbitmq.conf
    networks:
      - govconnect-network
    healthcheck:
      test: ["CMD", "rabbitmq-diagnostics", "ping"]
      interval: 10s
      timeout: 5s
      retries: 5

# ==================== NETWORKS ====================
networks:
  govconnect-network:
    driver: bridge
    name: govconnect-network

# ==================== VOLUMES ====================
volumes:
  pgdata-channel:
    name: govconnect-pgdata-channel
  pgdata-case:
    name: govconnect-pgdata-case
  pgdata-notification:
    name: govconnect-pgdata-notification
  pgdata-dashboard:
    name: govconnect-pgdata-dashboard
  pgdata-test:
    name: govconnect-pgdata-test
  rabbitmq-data:
    name: govconnect-rabbitmq-data
```

---

## 📄 DATABASE INIT SCRIPT

Create `docker/init-databases.sql`:

```sql
-- Enable extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- Set timezone
SET timezone = 'Asia/Jakarta';

-- Create initial admin user (will be used in dashboard)
-- Password: admin123 (hashed with bcrypt)
-- This will be created in Phase 5 when dashboard is ready

-- Log
SELECT 'Database initialized successfully' AS status;
SELECT version() AS postgresql_version;
SELECT current_database() AS database_name;
```

---

## 🐰 RABBITMQ CONFIG

Create `docker/rabbitmq.conf`:

```conf
# RabbitMQ Configuration for GovConnect

# Listeners
listeners.tcp.default = 5672
management.tcp.port = 15672

# Memory & Disk
vm_memory_high_watermark.relative = 0.6
disk_free_limit.absolute = 1GB

# Logging
log.console = true
log.console.level = info

# Management UI
management.load_definitions = /etc/rabbitmq/definitions.json
```

Create `docker/definitions.json` (RabbitMQ definitions):

```json
{
  "rabbit_version": "3.12.0",
  "rabbitmq_version": "3.12.0",
  "users": [
    {
      "name": "admin",
      "password_hash": "JcBWr0T3TxIXJxnTfAz+7eTqYzJIKZhgLq2gLLQC9bNlHpGP",
      "hashing_algorithm": "rabbit_password_hashing_sha256",
      "tags": "administrator"
    }
  ],
  "vhosts": [
    {
      "name": "govconnect"
    }
  ],
  "permissions": [
    {
      "user": "admin",
      "vhost": "govconnect",
      "configure": ".*",
      "write": ".*",
      "read": ".*"
    }
  ],
  "exchanges": [
    {
      "name": "govconnect.events",
      "vhost": "govconnect",
      "type": "topic",
      "durable": true,
      "auto_delete": false,
      "internal": false,
      "arguments": {}
    }
  ],
  "queues": [],
  "bindings": []
}
```

---

## 🔧 ENVIRONMENT VARIABLES TEMPLATE

Create `.env.example` di root:

```bash
# ==================== GOVCONNECT ENVIRONMENT ====================
# Copy this file to .env and fill in your values

# Environment
NODE_ENV=development

# PostgreSQL Databases
DB_CHANNEL_URL=postgresql://postgres:postgres_secret_2025@localhost:5432/gc_channel_db
DB_CASE_URL=postgresql://postgres:postgres_secret_2025@localhost:5433/gc_case_db
DB_NOTIFICATION_URL=postgresql://postgres:postgres_secret_2025@localhost:5434/gc_notification_db
DB_DASHBOARD_URL=postgresql://postgres:postgres_secret_2025@localhost:5435/gc_dashboard_db
DB_TEST_URL=postgresql://postgres:postgres_secret_2025@localhost:5436/gc_test_db

# RabbitMQ
RABBITMQ_URL=amqp://admin:rabbitmq_secret_2025@localhost:5672/govconnect
RABBITMQ_MANAGEMENT_URL=http://localhost:15672

# Internal API Keys (shared secret for inter-service authentication)
INTERNAL_API_KEY=govconnect_internal_secret_key_2025_change_in_production

# Service URLs (for local development)
CHANNEL_SERVICE_URL=http://localhost:3001
AI_SERVICE_URL=http://localhost:3002
CASE_SERVICE_URL=http://localhost:3003
NOTIFICATION_SERVICE_URL=http://localhost:3004
DASHBOARD_URL=http://localhost:3000

# WhatsApp Provider (fill in Phase 1)
WA_API_URL=
WA_API_TOKEN=
WA_WEBHOOK_SECRET=

# AI Provider (fill in Phase 2)
GEMINI_API_KEY=

# Dashboard JWT (fill in Phase 5)
JWT_SECRET=
JWT_EXPIRES_IN=24h

# Logging
LOG_LEVEL=debug
```

---

## 🧪 TESTING COMMANDS

### Start Infrastructure
```powershell
# Start all services
docker-compose up -d

# Check status
docker-compose ps

# View logs
docker-compose logs -f

# Stop all services
docker-compose down

# Stop and remove volumes (CAREFUL!)
docker-compose down -v
```

### Test Database Connections
```powershell
# Connect to Channel DB
docker exec -it govconnect-db-channel psql -U postgres -d gc_channel_db

# Connect to Case DB
docker exec -it govconnect-db-case psql -U postgres -d gc_case_db

# List all databases
docker exec -it govconnect-db-channel psql -U postgres -c "\l"
```

### Test RabbitMQ
```powershell
# Access Management UI
# Browser: http://localhost:15672
# Login: admin / rabbitmq_secret_2025

# Check RabbitMQ status
docker exec govconnect-rabbitmq rabbitmq-diagnostics status

# List exchanges
docker exec govconnect-rabbitmq rabbitmqctl list_exchanges -p govconnect
```

---

## 📁 FOLDER STRUCTURE (After Phase 0)

```
govconnect/
├── docker/
│   ├── init-databases.sql
│   ├── rabbitmq.conf
│   └── definitions.json
├── docs/
│   └── architecture.md
├── govconnect-channel-service/      (empty, akan dibuat Phase 1)
├── govconnect-ai-service/            (empty, akan dibuat Phase 2)
├── govconnect-case-service/          (empty, akan dibuat Phase 3)
├── govconnect-notification-service/  (empty, akan dibuat Phase 4)
├── govconnect-dashboard/             (empty, akan dibuat Phase 5)
├── .env.example
├── .gitignore
├── docker-compose.yml
├── GOVCONNECT_DEV_PHASES.md
└── README.md
```

---

## ✅ COMPLETION CRITERIA

Phase 0 dianggap selesai jika:

- [x] All Docker containers running (healthy) ✅
- [x] Can connect to PostgreSQL database ✅
- [x] All 5 schemas created (channel, cases, notification, dashboard, testing) ✅
- [x] Extensions installed (uuid-ossp, pgcrypto) ✅
- [x] RabbitMQ Management UI accessible ✅
- [x] Exchange `govconnect.events` created ✅
- [x] Vhost `govconnect` created ✅
- [x] All environment variables documented ✅
- [x] Folder structure created ✅
- [x] `.gitignore` configured properly ✅
- [x] Node.js 18+ installed (v23.4.0) ✅
- [x] pnpm installed (v9.11.0) ✅

---

## 🚀 NEXT STEPS

After completing Phase 0:
→ Go to **[Phase 1: Channel Service](./PHASE_1_CHANNEL_SERVICE.md)**

---

## 📝 NOTES

### ✅ Changes from Original Plan
- **Database Architecture**: Changed from 5 separate PostgreSQL instances to **1 single instance with 5 schemas**
  - Easier to manage
  - Lower resource usage
  - Simpler connection strings
  - Better for local development
  
### Tips
- Gunakan Docker Desktop GUI untuk monitor containers
- Save password di password manager
- Jangan commit `.env` ke git
- Test koneksi database sebelum lanjut phase berikutnya
- Use schema-qualified queries: `SELECT * FROM channel.messages;`

### Troubleshooting
- Port already in use? Change port di `docker-compose.yml`
- Container won't start? Check `docker-compose logs [service-name]`
- RabbitMQ UI not accessible? Wait 30s after startup
- Database connection refused? Check healthcheck status with `docker-compose ps`

---

**Phase 0 Status**: ✅ **COMPLETE**  
**Completion Date**: November 24, 2025  
**Duration**: ~2 hours  
**Next Phase**: Phase 1 - Channel Service
