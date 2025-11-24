# PHASE 7: DEPLOYMENT

**Duration**: 3-4 jam  
**Complexity**: ⭐⭐ Medium  
**Prerequisites**: Phase 0-6 completed

---

## 🎯 OBJECTIVES

- Setup production environment
- Deploy all services via Docker Compose
- Configure production databases
- Setup monitoring & logging
- Configure domain & SSL
- Final testing in production

---

## 📋 CHECKLIST

### 1. Pre-Deployment Preparation

- [ ] **Environment Variables**:
  - [ ] Create `.env.production` untuk semua services
  - [ ] Generate production API keys & secrets
  - [ ] Setup WA API credentials (production)
  - [ ] Setup Gemini API key (production quota)
  - [ ] Setup strong JWT secret
- [ ] **Database Backup**:
  - [ ] Backup seed data
  - [ ] Document restore procedure
- [ ] **Code Review Final**:
  - [ ] Remove all console.log
  - [ ] Remove development comments
  - [ ] Check all error handlers
  - [ ] Verify no hardcoded URLs

### 2. Docker Images

- [ ] **Build all Docker images**:
  - [ ] Service 1 (Channel): `docker build -t govconnect-channel:latest`
  - [ ] Service 2 (AI): `docker build -t govconnect-ai:latest`
  - [ ] Service 3 (Case): `docker build -t govconnect-case:latest`
  - [ ] Service 4 (Dashboard): `docker build -t govconnect-dashboard:latest`
  - [ ] Service 5 (Notification): `docker build -t govconnect-notification:latest`
- [ ] Test all images locally
- [ ] Push to registry (optional: Docker Hub / private registry)

### 3. Production Docker Compose

- [ ] Create `docker-compose.prod.yml`:
  - [ ] Use production environment variables
  - [ ] Configure restart policies (`restart: always`)
  - [ ] Setup health checks
  - [ ] Configure resource limits
  - [ ] Setup networks & volumes
- [ ] Add Nginx reverse proxy (optional)
- [ ] Add SSL certificates (Let's Encrypt)

### 4. Server Setup

- [ ] **Provision Server** (VPS / Cloud):
  - [ ] Minimum: 4 CPU, 8GB RAM, 50GB SSD
  - [ ] OS: Ubuntu 22.04 LTS
  - [ ] Install Docker & Docker Compose
  - [ ] Install Nginx (if not using Docker)
  - [ ] Configure firewall (UFW)
- [ ] **Clone Repository**:
  - [ ] `git clone <repo>`
  - [ ] Copy `.env.production`
  - [ ] Set correct file permissions

### 5. Database Migration

- [ ] Run migrations for all services:
  - [ ] `docker-compose -f docker-compose.prod.yml run channel-service pnpm prisma migrate deploy`
  - [ ] Repeat for case-service, notification-service, dashboard
- [ ] Seed default admin user (dashboard)
- [ ] Verify all tables created

### 6. Deployment

- [ ] Start services:
  ```bash
  docker-compose -f docker-compose.prod.yml up -d
  ```
- [ ] Check all containers running:
  ```bash
  docker-compose ps
  ```
- [ ] Check logs:
  ```bash
  docker-compose logs -f
  ```

### 7. Domain & SSL Setup

- [ ] **Configure Domain**:
  - [ ] Point domain to server IP (A record)
  - [ ] Subdomain for dashboard: `dashboard.govconnect.id`
  - [ ] Subdomain for webhook: `api.govconnect.id`
- [ ] **Setup SSL**:
  - [ ] Install Certbot
  - [ ] Generate Let's Encrypt certificates
  - [ ] Configure Nginx with SSL
  - [ ] Auto-renewal setup

### 8. WhatsApp Webhook Configuration

- [ ] Configure webhook URL in WA provider:
  - [ ] URL: `https://api.govconnect.id/webhook/whatsapp`
  - [ ] Verify token setup
  - [ ] Test webhook delivery
- [ ] Verify HMAC signature (if enabled)

### 9. Monitoring & Logging

- [ ] **Setup Log Rotation**:
  - [ ] Configure logrotate for all services
  - [ ] Keep last 7 days of logs
- [ ] **Setup Monitoring** (optional):
  - [ ] Install Prometheus + Grafana (or use cloud monitoring)
  - [ ] Setup alerts (email/Slack)
  - [ ] Monitor:
    - [ ] CPU & memory usage
    - [ ] Disk space
    - [ ] Service health
    - [ ] RabbitMQ queue depth
    - [ ] Database connections
- [ ] **Error Tracking** (optional):
  - [ ] Setup Sentry or similar
  - [ ] Configure error reporting

### 10. Production Testing

- [ ] **Smoke Tests**:
  - [ ] Send test webhook → verify end-to-end flow
  - [ ] Login to dashboard → verify access
  - [ ] Create test complaint → verify in DB
  - [ ] Update status → verify notification sent
- [ ] **Load Test**:
  - [ ] Run load test script (100 concurrent requests)
  - [ ] Monitor server resources
  - [ ] Check for errors
- [ ] **Security Scan**:
  - [ ] Run SSL test (ssllabs.com)
  - [ ] Check open ports (`nmap`)
  - [ ] Verify firewall rules

### 11. Backup & Recovery

- [ ] **Database Backup**:
  - [ ] Setup automated daily backups (pg_dump)
  - [ ] Store backups off-site (S3 / Backblaze)
  - [ ] Test restore procedure
- [ ] **Code Backup**:
  - [ ] Push to Git repository
  - [ ] Tag release version
- [ ] **Disaster Recovery Plan**:
  - [ ] Document restore steps
  - [ ] Document rollback procedure

### 12. Documentation

- [ ] **Production README**:
  - [ ] Server specs
  - [ ] Deployment steps
  - [ ] Monitoring URLs
  - [ ] Emergency contacts
- [ ] **Runbook**:
  - [ ] How to restart services
  - [ ] How to view logs
  - [ ] How to scale
  - [ ] Common issues & fixes
- [ ] **User Guide** (for admin):
  - [ ] How to login
  - [ ] How to manage laporan/tiket
  - [ ] How to update status

---

## 📦 PRODUCTION DOCKER COMPOSE

`docker-compose.prod.yml`:

```yaml
version: '3.8'

services:
  # ==================== INFRASTRUCTURE ====================
  db-channel:
    image: postgres:15-alpine
    container_name: govconnect-db-channel-prod
    restart: always
    environment:
      POSTGRES_DB: gc_channel_db
      POSTGRES_USER: ${DB_USER}
      POSTGRES_PASSWORD: ${DB_PASSWORD}
    volumes:
      - pgdata-channel-prod:/var/lib/postgresql/data
    networks:
      - govconnect-prod
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U ${DB_USER}"]
      interval: 30s
      timeout: 10s
      retries: 5

  db-case:
    image: postgres:15-alpine
    container_name: govconnect-db-case-prod
    restart: always
    environment:
      POSTGRES_DB: gc_case_db
      POSTGRES_USER: ${DB_USER}
      POSTGRES_PASSWORD: ${DB_PASSWORD}
    volumes:
      - pgdata-case-prod:/var/lib/postgresql/data
    networks:
      - govconnect-prod

  db-notification:
    image: postgres:15-alpine
    container_name: govconnect-db-notification-prod
    restart: always
    environment:
      POSTGRES_DB: gc_notification_db
      POSTGRES_USER: ${DB_USER}
      POSTGRES_PASSWORD: ${DB_PASSWORD}
    volumes:
      - pgdata-notification-prod:/var/lib/postgresql/data
    networks:
      - govconnect-prod

  db-dashboard:
    image: postgres:15-alpine
    container_name: govconnect-db-dashboard-prod
    restart: always
    environment:
      POSTGRES_DB: gc_dashboard_db
      POSTGRES_USER: ${DB_USER}
      POSTGRES_PASSWORD: ${DB_PASSWORD}
    volumes:
      - pgdata-dashboard-prod:/var/lib/postgresql/data
    networks:
      - govconnect-prod

  rabbitmq:
    image: rabbitmq:3.12-management-alpine
    container_name: govconnect-rabbitmq-prod
    restart: always
    environment:
      RABBITMQ_DEFAULT_USER: ${RABBITMQ_USER}
      RABBITMQ_DEFAULT_PASS: ${RABBITMQ_PASSWORD}
      RABBITMQ_DEFAULT_VHOST: govconnect
    volumes:
      - rabbitmq-data-prod:/var/lib/rabbitmq
    networks:
      - govconnect-prod

  # ==================== SERVICES ====================
  channel-service:
    build: ./govconnect-channel-service
    container_name: govconnect-channel-prod
    restart: always
    env_file: .env.production
    depends_on:
      - db-channel
      - rabbitmq
    networks:
      - govconnect-prod
    healthcheck:
      test: ["CMD", "wget", "--quiet", "--tries=1", "--spider", "http://localhost:3001/health"]
      interval: 30s
      timeout: 10s
      retries: 3

  ai-service:
    build: ./govconnect-ai-service
    container_name: govconnect-ai-prod
    restart: always
    env_file: .env.production
    depends_on:
      - rabbitmq
      - channel-service
      - case-service
    networks:
      - govconnect-prod

  case-service:
    build: ./govconnect-case-service
    container_name: govconnect-case-prod
    restart: always
    env_file: .env.production
    depends_on:
      - db-case
      - rabbitmq
    networks:
      - govconnect-prod

  notification-service:
    build: ./govconnect-notification-service
    container_name: govconnect-notification-prod
    restart: always
    env_file: .env.production
    depends_on:
      - db-notification
      - rabbitmq
      - channel-service
    networks:
      - govconnect-prod

  dashboard:
    build: ./govconnect-dashboard
    container_name: govconnect-dashboard-prod
    restart: always
    env_file: .env.production
    depends_on:
      - db-dashboard
      - case-service
    networks:
      - govconnect-prod

  # ==================== REVERSE PROXY ====================
  nginx:
    image: nginx:alpine
    container_name: govconnect-nginx-prod
    restart: always
    ports:
      - "80:80"
      - "443:443"
    volumes:
      - ./nginx/nginx.conf:/etc/nginx/nginx.conf:ro
      - ./nginx/ssl:/etc/nginx/ssl:ro
      - ./nginx/logs:/var/log/nginx
    depends_on:
      - channel-service
      - dashboard
    networks:
      - govconnect-prod

networks:
  govconnect-prod:
    driver: bridge

volumes:
  pgdata-channel-prod:
  pgdata-case-prod:
  pgdata-notification-prod:
  pgdata-dashboard-prod:
  rabbitmq-data-prod:
```

---

## 🔧 NGINX CONFIGURATION

`nginx/nginx.conf`:

```nginx
events {
    worker_connections 1024;
}

http {
    upstream channel_service {
        server channel-service:3001;
    }

    upstream dashboard {
        server dashboard:3000;
    }

    # Redirect HTTP to HTTPS
    server {
        listen 80;
        server_name api.govconnect.id dashboard.govconnect.id;
        return 301 https://$host$request_uri;
    }

    # API (Webhook)
    server {
        listen 443 ssl http2;
        server_name api.govconnect.id;

        ssl_certificate /etc/nginx/ssl/fullchain.pem;
        ssl_certificate_key /etc/nginx/ssl/privkey.pem;

        location / {
            proxy_pass http://channel_service;
            proxy_set_header Host $host;
            proxy_set_header X-Real-IP $remote_addr;
            proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
            proxy_set_header X-Forwarded-Proto $scheme;
        }
    }

    # Dashboard
    server {
        listen 443 ssl http2;
        server_name dashboard.govconnect.id;

        ssl_certificate /etc/nginx/ssl/fullchain.pem;
        ssl_certificate_key /etc/nginx/ssl/privkey.pem;

        location / {
            proxy_pass http://dashboard;
            proxy_set_header Host $host;
            proxy_set_header X-Real-IP $remote_addr;
            proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
            proxy_set_header X-Forwarded-Proto $scheme;
        }
    }
}
```

---

## 🔐 PRODUCTION SECRETS

Generate strong secrets:

```bash
# JWT Secret (32 characters)
openssl rand -base64 32

# Internal API Key (64 characters)
openssl rand -base64 64

# Database Password (24 characters)
openssl rand -base64 24
```

---

## 🚀 DEPLOYMENT COMMANDS

```bash
# 1. Clone repository
git clone https://github.com/your-org/govconnect.git
cd govconnect

# 2. Checkout production branch/tag
git checkout v1.0.0

# 3. Copy environment variables
cp .env.production.example .env.production
# Edit .env.production dengan nilai production

# 4. Build images
docker-compose -f docker-compose.prod.yml build

# 5. Start services
docker-compose -f docker-compose.prod.yml up -d

# 6. Run migrations
docker-compose -f docker-compose.prod.yml exec channel-service pnpm prisma migrate deploy
docker-compose -f docker-compose.prod.yml exec case-service pnpm prisma migrate deploy
docker-compose -f docker-compose.prod.yml exec notification-service pnpm prisma migrate deploy
docker-compose -f docker-compose.prod.yml exec dashboard pnpm prisma migrate deploy

# 7. Seed admin user
docker-compose -f docker-compose.prod.yml exec dashboard pnpm prisma db seed

# 8. Check logs
docker-compose -f docker-compose.prod.yml logs -f
```

---

## 📊 MONITORING CHECKLIST

### Daily Checks
- [ ] All containers running
- [ ] Disk space > 20%
- [ ] No critical errors in logs
- [ ] RabbitMQ queue depth < 100

### Weekly Checks
- [ ] Database backup successful
- [ ] SSL certificate valid (> 30 days remaining)
- [ ] Review error logs
- [ ] Check performance metrics

### Monthly Checks
- [ ] Update dependencies (security patches)
- [ ] Review resource usage trends
- [ ] Test disaster recovery
- [ ] Review and archive old logs

---

## ✅ COMPLETION CRITERIA

Phase 7 dianggap selesai jika:

- [x] All services deployed and running
- [x] SSL configured and working
- [x] Webhook receiving messages
- [x] Dashboard accessible
- [x] End-to-end production test passed
- [x] Monitoring setup and working
- [x] Backup automated
- [x] Documentation complete

---

## 🎉 PROJECT COMPLETE!

Selamat! GovConnect sudah siap production.

### Next Steps:
1. Monitor logs harian minggu pertama
2. Siapkan user training untuk admin dashboard
3. Launch soft testing dengan user terbatas
4. Full launch setelah 2 minggu stable

---

**Phase 7 Status**: 🔴 Not Started  
**Last Updated**: November 24, 2025

---

**🏆 GOVCONNECT DEVELOPMENT COMPLETE! 🏆**
