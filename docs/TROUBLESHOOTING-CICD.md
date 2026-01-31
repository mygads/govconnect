# 🔧 Troubleshooting CI/CD Pipeline

## Common Issues & Solutions

### 1. **Authentication Errors**

#### Symptoms:
- `Permission denied (publickey)`
- `Login failed` untuk GHCR
- `Invalid credentials`

#### Solutions:
```bash
# Check secrets di GitHub repository settings
# Required secrets:
- VPS_HOST: IP address server (contoh: 203.194.112.xxx)
- VPS_USER: SSH username (contoh: root atau ubuntu)
- VPS_SSH_KEY: Private SSH key (format OpenSSH)
- GHCR_TOKEN: GitHub Personal Access Token dengan packages:write permission
```

#### Generate SSH Key:
```bash
# Di local machine
ssh-keygen -t ed25519 -C "github-actions@govconnect"

# Copy public key ke server
ssh-copy-id -i ~/.ssh/id_ed25519.pub user@server

# Copy private key ke GitHub secrets (VPS_SSH_KEY)
cat ~/.ssh/id_ed25519
```

#### Generate GHCR Token:
1. GitHub → Settings → Developer settings → Personal access tokens → Tokens (classic)
2. Generate new token dengan scope: `write:packages`, `read:packages`
3. Copy token ke GitHub secrets (GHCR_TOKEN)

### 2. **Docker Build Failures**

#### Symptoms:
- `Build failed` di step build-dashboard/build-*
- `npm install failed`
- `prisma generate failed`

#### Solutions:
```bash
# Test build locally
cd govconnect-dashboard
docker build -t test-dashboard .

# Check Dockerfile syntax
docker compose config

# Clear build cache
docker builder prune -af
```

#### Common Dockerfile Issues:
- **Prisma generation**: Pastikan DATABASE_URL dummy tersedia
- **Node version**: Gunakan node:22-alpine yang konsisten
- **Dependencies**: Pastikan pnpm-lock.yaml up-to-date

### 3. **Deployment Failures**

#### Symptoms:
- `SSH connection failed`
- `docker compose pull failed`
- `Container failed to start`

#### Solutions:

##### Check SSH Connection:
```bash
# Test manual SSH
ssh user@server

# Check SSH key format
head -1 ~/.ssh/id_ed25519  # Should start with -----BEGIN OPENSSH PRIVATE KEY-----
```

##### Check Server Resources:
```bash
# On server
free -h          # Memory usage
df -h            # Disk usage
docker system df # Docker disk usage

# Cleanup if needed
docker system prune -af
```

##### Check Networks:
```bash
# On server
docker network ls
docker network create govconnect-network
docker network create infra-network
```

### 4. **Database Migration Issues**

#### Symptoms:
- `Migration failed`
- `Database connection refused`
- `Prisma client not found`

#### Solutions:

##### Check PostgreSQL:
```bash
# On server
sudo -u postgres psql -c '\l'  # List databases
sudo systemctl status postgresql
```

##### Manual Migration:
```bash
# On server
cd ~/genfity/govconnect
export DATABASE_URL="postgresql://postgres:password@localhost:5432/gc_dashboard"

# Run migration manually
docker run --rm \
  --network govconnect-network \
  -e DATABASE_URL="$DATABASE_URL" \
  -v "$PWD/govconnect-dashboard/prisma":/app/prisma:ro \
  node:22-alpine sh -c "
    npm install prisma@latest
    npx prisma migrate deploy
  "
```

### 5. **Container Health Check Failures**

#### Symptoms:
- `Health check failed`
- `Service not responding`
- `Connection refused`

#### Solutions:

##### Check Container Logs:
```bash
# On server
docker compose logs dashboard
docker compose logs channel-service
docker compose logs ai-service
```

##### Check Port Binding:
```bash
# On server
netstat -tlnp | grep :3000  # Dashboard
netstat -tlnp | grep :3001  # Channel
curl http://localhost:3000/  # Test locally
```

##### Manual Container Start:
```bash
# On server
docker compose up -d dashboard
docker compose ps
docker compose logs -f dashboard
```

### 6. **Memory/Resource Issues**

#### Symptoms:
- `Container killed (OOMKilled)`
- `Build timeout`
- `Deployment slow/hanging`

#### Solutions:

##### Check Memory Usage:
```bash
# On server
free -h
docker stats --no-stream
```

##### Optimize Deployment:
```bash
# Sequential startup (already implemented in CI/CD)
docker compose up -d channel-service
sleep 10
docker compose up -d case-service
sleep 10
# ... etc
```

##### Cleanup Resources:
```bash
# On server
docker system prune -af
docker volume prune -f
docker image prune -af --filter "until=24h"
```

## Debugging Tools

### 1. **Use Debug Script**
```bash
# On server
cd ~/genfity/govconnect
./scripts/debug-deployment.sh
```

### 2. **Manual Deployment Test**
```bash
# On server
cd ~/genfity/govconnect

# Test docker compose
docker compose config
docker compose pull
docker compose up -d

# Check status
docker compose ps
docker compose logs
```

### 3. **Check GitHub Actions Logs**
1. Go to GitHub repository → Actions
2. Click on failed workflow run
3. Expand failed step to see detailed logs
4. Look for specific error messages

## Prevention Tips

### 1. **Regular Maintenance**
```bash
# Weekly cleanup (add to cron)
docker system prune -af --filter "until=168h"  # 1 week
docker volume prune -f
```

### 2. **Monitor Resources**
```bash
# Add monitoring
df -h / | awk 'NR==2{print $5}' | sed 's/%//'  # Disk usage %
free | awk 'NR==2{printf "%.2f%%\n", $3*100/$2}'  # Memory usage %
```

### 3. **Test Before Push**
```bash
# Local testing
docker compose build
docker compose up -d
docker compose ps
```

### 4. **Validate Secrets**
- Test SSH connection manually
- Verify GHCR token permissions
- Check .env file completeness

## Emergency Recovery

### 1. **Complete Reset**
```bash
# On server - DANGER: This will destroy all data
cd ~/genfity/govconnect
docker compose down -v
docker system prune -af
git reset --hard origin/main
docker compose up -d --build
```

### 2. **Rollback to Previous Version**
```bash
# On server
cd ~/genfity/govconnect
git log --oneline -10  # Find previous commit
git reset --hard <commit-hash>
docker compose up -d --build
```

### 3. **Manual Deployment**
```bash
# Skip CI/CD, deploy manually
ssh user@server
cd ~/genfity/govconnect
git pull origin main
docker compose build
docker compose up -d
```

## Contact & Support

Jika masalah masih berlanjut:
1. Check GitHub Issues untuk masalah serupa
2. Collect logs: `docker compose logs > deployment-logs.txt`
3. Run debug script: `./scripts/debug-deployment.sh > debug-output.txt`
4. Share logs dengan tim development