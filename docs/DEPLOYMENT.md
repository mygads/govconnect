# GovConnect Deployment Guide

## Domain Configuration

| Domain | Service | Description |
|--------|---------|-------------|
| `govconnect.my.id` | Dashboard | Main admin dashboard (Next.js) |
| `api.govconnect.my.id` | API Gateway | REST API & WhatsApp Webhook |

## VPS Requirements

### Minimum Specs
- **CPU**: 2 vCPU
- **RAM**: 4 GB
- **Storage**: 40 GB SSD
- **OS**: Ubuntu 22.04 LTS / Debian 12
- **Network**: IPv4 + IPv6 dual-stack

### Required Ports
| Port | Protocol | Usage |
|------|----------|-------|
| 22 | TCP | SSH |
| 80 | TCP | HTTP (redirect to HTTPS) |
| 443 | TCP | HTTPS |
| 5672 | TCP | RabbitMQ (internal only) |
| 5432 | TCP | PostgreSQL (internal only) |

---

## Option 1: Docker Compose Deployment (Recommended for VPS)

### Step 1: DNS Configuration

Configure your domain DNS records:

```
# A Records (IPv4)
govconnect.my.id      A     YOUR_VPS_IPV4
api.govconnect.my.id  A     YOUR_VPS_IPV4

# AAAA Records (IPv6)  
govconnect.my.id      AAAA  YOUR_VPS_IPV6
api.govconnect.my.id  AAAA  YOUR_VPS_IPV6
```

### Step 2: Install Dependencies

```bash
# Update system
sudo apt update && sudo apt upgrade -y

# Install Docker
curl -fsSL https://get.docker.com | sudo sh
sudo usermod -aG docker $USER

# Install Docker Compose
sudo apt install docker-compose-plugin -y

# Verify installation
docker --version
docker compose version
```

### Step 3: Clone Repository

```bash
git clone https://github.com/your-org/govconnect.git
cd govconnect
```

### Step 4: Configure Environment

```bash
# Copy example env file
cp .env.production.example .env.production

# Edit with your actual values
nano .env.production
```

**Required changes in `.env.production`:**
```env
# Database
POSTGRES_PASSWORD=your_secure_password_here

# JWT Secret (generate with: openssl rand -base64 64)
JWT_SECRET=your_generated_jwt_secret

# WhatsApp API
GENFITY_BASE_URL=https://your-wa-api-url
GENFITY_API_KEY=your_wa_api_key
GENFITY_ACCOUNT_ID=your_account_id

# LLM API
GEMINI_API_KEY=your_gemini_api_key
```

### Step 5: SSL Certificate Setup

```bash
# Make script executable
chmod +x scripts/ssl-setup.sh

# Run SSL setup
sudo ./scripts/ssl-setup.sh
```

**Or manually with Certbot:**
```bash
# Install Certbot
sudo apt install certbot -y

# Get certificates
sudo certbot certonly --standalone \
  -d govconnect.my.id \
  -d api.govconnect.my.id \
  --email admin@govconnect.my.id \
  --agree-tos
```

### Step 6: Deploy

```bash
# Start all services
docker compose -f docker-compose.prod.yml up -d

# Check status
docker compose -f docker-compose.prod.yml ps

# View logs
docker compose -f docker-compose.prod.yml logs -f
```

### Step 7: Verify Deployment

```bash
# Check Dashboard
curl -I https://govconnect.my.id

# Check API Health
curl https://api.govconnect.my.id/health

# Check Webhook endpoint
curl -I https://api.govconnect.my.id/webhook/whatsapp
```

---

## Option 2: Kubernetes Deployment

### Prerequisites
- Kubernetes cluster (k3s, microk8s, or managed K8s)
- kubectl configured
- NGINX Ingress Controller installed

### Step 1: Install NGINX Ingress Controller

```bash
kubectl apply -f https://raw.githubusercontent.com/kubernetes/ingress-nginx/controller-v1.8.2/deploy/static/provider/cloud/deploy.yaml
```

### Step 2: Configure Secrets

Edit `k8s/02-secrets.yaml` with base64-encoded values:

```bash
# Generate base64 encoded secrets
echo -n 'your_password' | base64
echo -n 'your_jwt_secret' | base64
```

### Step 3: Deploy to Kubernetes

```bash
cd k8s

# Make deploy script executable
chmod +x deploy.sh

# Deploy all resources
./deploy.sh

# Or manually
kubectl apply -k .
```

### Step 4: Configure TLS with cert-manager

```bash
# Install cert-manager
kubectl apply -f https://github.com/cert-manager/cert-manager/releases/download/v1.13.0/cert-manager.yaml

# Create ClusterIssuer for Let's Encrypt
cat <<EOF | kubectl apply -f -
apiVersion: cert-manager.io/v1
kind: ClusterIssuer
metadata:
  name: letsencrypt-prod
spec:
  acme:
    server: https://acme-v02.api.letsencrypt.org/directory
    email: admin@govconnect.my.id
    privateKeySecretRef:
      name: letsencrypt-prod
    solvers:
    - http01:
        ingress:
          class: nginx
EOF
```

### Step 5: Enable TLS in Ingress

Uncomment TLS section in `k8s/30-ingress.yaml`:

```yaml
spec:
  ingressClassName: nginx
  tls:
    - hosts:
        - govconnect.my.id
        - api.govconnect.my.id
      secretName: govconnect-tls
```

---

## IPv4 & IPv6 Dual-Stack Configuration

### NGINX Configuration (docker-compose)

The NGINX config already supports dual-stack:

```nginx
server {
    listen 80;
    listen [::]:80;        # IPv6
    listen 443 ssl http2;
    listen [::]:443 ssl http2;  # IPv6
    ...
}
```

### Kubernetes Dual-Stack

For Kubernetes, ensure your cluster supports dual-stack and configure services:

```yaml
apiVersion: v1
kind: Service
metadata:
  name: dashboard
spec:
  ipFamilies:
    - IPv4
    - IPv6
  ipFamilyPolicy: PreferDualStack
```

---

## Service URLs Reference

### Internal (Docker Network / Kubernetes DNS)
| Service | URL |
|---------|-----|
| Channel Service | `http://channel-service:3001` |
| AI Service | `http://ai-service:3002` |
| Case Service | `http://case-service:3003` |
| Notification Service | `http://notification-service:3004` |
| Dashboard | `http://dashboard:3000` |
| PostgreSQL | `postgres:5432` |
| RabbitMQ | `rabbitmq:5672` |

### External (Public)
| Service | URL |
|---------|-----|
| Dashboard | `https://govconnect.my.id` |
| API Gateway | `https://api.govconnect.my.id` |
| WhatsApp Webhook | `https://api.govconnect.my.id/webhook/whatsapp` |

---

## Troubleshooting

### Check Service Health

```bash
# Docker Compose
docker compose -f docker-compose.prod.yml exec dashboard curl localhost:3000/api/health
docker compose -f docker-compose.prod.yml exec channel-service curl localhost:3001/health

# Kubernetes
kubectl exec -it deployment/dashboard -n govconnect -- curl localhost:3000/api/health
```

### Database Issues

```bash
# Docker - Check PostgreSQL
docker compose -f docker-compose.prod.yml exec postgres psql -U postgres -d govconnect -c "\dt channel.*"

# Kubernetes
kubectl exec -it statefulset/postgres -n govconnect -- psql -U postgres -d govconnect -c "\dt channel.*"
```

### View Logs

```bash
# Docker
docker compose -f docker-compose.prod.yml logs channel-service -f

# Kubernetes
kubectl logs -f deployment/channel-service -n govconnect
```

### Restart Services

```bash
# Docker
docker compose -f docker-compose.prod.yml restart channel-service

# Kubernetes
kubectl rollout restart deployment/channel-service -n govconnect
```

---

## Backup & Recovery

### Database Backup

```bash
# Docker
docker compose -f docker-compose.prod.yml exec postgres pg_dump -U postgres govconnect > backup_$(date +%Y%m%d).sql

# Kubernetes
kubectl exec -it statefulset/postgres -n govconnect -- pg_dump -U postgres govconnect > backup_$(date +%Y%m%d).sql
```

### Database Restore

```bash
# Docker
cat backup.sql | docker compose -f docker-compose.prod.yml exec -T postgres psql -U postgres govconnect

# Kubernetes  
cat backup.sql | kubectl exec -i statefulset/postgres -n govconnect -- psql -U postgres govconnect
```

---

## Security Checklist

- [ ] Change default passwords in `.env.production`
- [ ] Generate strong JWT_SECRET
- [ ] Enable SSL/TLS certificates
- [ ] Configure firewall (only 80, 443 exposed)
- [ ] Set up automated backups
- [ ] Enable log rotation
- [ ] Configure rate limiting (already in NGINX)
- [ ] Review CORS settings for production

---

## Support

For issues, check:
1. Service logs
2. Database connectivity
3. RabbitMQ queue status
4. Network/firewall settings
5. SSL certificate validity
