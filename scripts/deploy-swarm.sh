#!/bin/bash
# ===================================================================================
# GOVCONNECT - DOCKER SWARM DEPLOYMENT SCRIPT
# ===================================================================================
# 
# Script untuk deploy GovConnect ke Docker Swarm
# Run di server: bash scripts/deploy-swarm.sh
#
# ===================================================================================

set -e

echo "=========================================="
echo "  GovConnect Docker Swarm Deployment"
echo "=========================================="
echo ""

cd /opt/govconnect

# 1. Pull latest code
echo ">>> Pulling latest code..."
git pull origin main

# 2. Copy .env.production to .env if not exists
if [ ! -f .env ]; then
  echo ">>> Copying .env.production to .env..."
  cp .env.production .env
fi

# 3. Load environment variables
echo ">>> Loading environment variables..."
set -a
source .env
set +a

# 4. Stop existing docker-compose containers (if any)
echo ">>> Stopping existing containers..."
docker compose down --remove-orphans 2>/dev/null || true

# 5. Initialize Swarm if not already
if ! docker info 2>/dev/null | grep -q "Swarm: active"; then
  echo ">>> Initializing Docker Swarm..."
  INTERNAL_IP=$(hostname -I | awk '{print $1}')
  docker swarm init --advertise-addr $INTERNAL_IP
else
  echo ">>> Docker Swarm already active"
fi

# 6. Build images locally
echo ""
echo ">>> Building images..."
docker compose -f docker-compose.swarm.yml build

# 7. Deploy stack (env vars already loaded)
echo ""
echo ">>> Deploying stack..."
docker stack deploy -c docker-compose.swarm.yml govconnect

# 8. Wait for services to start
echo ""
echo ">>> Waiting for services to start (30s)..."
sleep 30

# 9. Check service status
echo ""
echo "--- Service Status ---"
docker stack services govconnect

echo ""
echo "--- Recent Logs (ai-service) ---"
docker service logs govconnect_ai-service --tail 20 2>/dev/null || echo "Service not ready yet"

echo ""
echo "=========================================="
echo "  Deployment Complete!"
echo "=========================================="
echo ""
echo "Commands:"
echo "  View services:  docker stack services govconnect"
echo "  View logs:      docker service logs -f govconnect_ai-service"
echo "  Update service: docker service update --force govconnect_ai-service"
echo "  Remove stack:   docker stack rm govconnect"
echo ""
