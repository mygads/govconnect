#!/bin/bash

# ===================================================================================
# GOVCONNECT - DEPLOYMENT DEBUGGING SCRIPT
# ===================================================================================
# 
# Script untuk debugging masalah deployment
# Usage: ./scripts/debug-deployment.sh
#
# ===================================================================================

set -e

echo "🔍 GovConnect Deployment Debug Script"
echo "======================================"

# Check if we're in the right directory
if [ ! -f "docker-compose.yml" ]; then
    echo "❌ Error: docker-compose.yml not found. Please run from govconnect root directory."
    exit 1
fi

echo ""
echo "📋 System Information:"
echo "- Date: $(date)"
echo "- User: $(whoami)"
echo "- PWD: $(pwd)"
echo "- Docker version: $(docker --version 2>/dev/null || echo 'Docker not found')"
echo "- Docker Compose version: $(docker compose version 2>/dev/null || echo 'Docker Compose not found')"

echo ""
echo "🔗 Network Status:"
echo "- Docker networks:"
docker network ls | grep -E "(govconnect|infra)" || echo "  No govconnect/infra networks found"

echo ""
echo "📦 Container Status:"
docker compose ps 2>/dev/null || echo "No containers running"

echo ""
echo "🖼️ Image Status:"
echo "- Local images:"
docker images | grep govconnect || echo "  No govconnect images found"

echo ""
echo "📊 Resource Usage:"
echo "- Memory usage:"
free -h 2>/dev/null || echo "  Memory info not available"
echo "- Disk usage:"
df -h . 2>/dev/null || echo "  Disk info not available"

echo ""
echo "🔍 Environment Check:"
if [ -f ".env" ]; then
    echo "✅ .env file exists"
    echo "- Environment variables count: $(grep -c "^[^#]" .env 2>/dev/null || echo 0)"
else
    echo "❌ .env file missing"
fi

echo ""
echo "🗃️ Database Check:"
if command -v psql >/dev/null 2>&1; then
    echo "✅ PostgreSQL client available"
    if sudo -u postgres psql -c '\l' >/dev/null 2>&1; then
        echo "✅ PostgreSQL server accessible"
        echo "- Databases:"
        sudo -u postgres psql -c '\l' | grep gc_ || echo "  No govconnect databases found"
    else
        echo "❌ PostgreSQL server not accessible"
    fi
else
    echo "❌ PostgreSQL client not available"
fi

echo ""
echo "🔧 Docker Compose Validation:"
if docker compose config >/dev/null 2>&1; then
    echo "✅ docker-compose.yml is valid"
else
    echo "❌ docker-compose.yml has errors:"
    docker compose config 2>&1 || true
fi

echo ""
echo "📝 Recent Logs (last 50 lines):"
echo "================================"
docker compose logs --tail=50 2>/dev/null || echo "No logs available"

echo ""
echo "🏥 Health Check:"
echo "================"

services=("channel-service:3001" "ai-service:3002" "case-service:3003" "notification-service:3004" "dashboard:3000")

for service in "${services[@]}"; do
    name=$(echo $service | cut -d: -f1)
    port=$(echo $service | cut -d: -f2)
    
    if curl -sf "http://localhost:$port/health" >/dev/null 2>&1 || curl -sf "http://localhost:$port/" >/dev/null 2>&1; then
        echo "✅ $name (port $port) - OK"
    else
        echo "❌ $name (port $port) - FAILED"
    fi
done

echo ""
echo "🔍 Troubleshooting Suggestions:"
echo "==============================="

if [ ! -f ".env" ]; then
    echo "1. Create .env file: cp .env.example .env"
fi

if ! docker network ls | grep -q govconnect-network; then
    echo "2. Create networks: docker network create govconnect-network"
fi

if ! docker network ls | grep -q infra-network; then
    echo "3. Create networks: docker network create infra-network"
fi

if ! docker compose ps | grep -q "running"; then
    echo "4. Start services: docker compose up -d"
fi

echo "5. Check logs: docker compose logs -f [service-name]"
echo "6. Rebuild images: docker compose build --no-cache"
echo "7. Reset everything: docker compose down && docker compose up -d --build"

echo ""
echo "✅ Debug script completed!"