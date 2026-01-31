# ===================================================================================
# GOVCONNECT - DEPLOYMENT DEBUGGING SCRIPT (PowerShell)
# ===================================================================================
# 
# Script untuk debugging masalah deployment di Windows
# Usage: .\scripts\debug-deployment.ps1
#
# ===================================================================================

Write-Host "🔍 GovConnect Deployment Debug Script" -ForegroundColor Cyan
Write-Host "======================================" -ForegroundColor Cyan

# Check if we're in the right directory
if (-not (Test-Path "docker-compose.yml")) {
    Write-Host "❌ Error: docker-compose.yml not found. Please run from govconnect root directory." -ForegroundColor Red
    exit 1
}

Write-Host ""
Write-Host "📋 System Information:" -ForegroundColor Yellow
Write-Host "- Date: $(Get-Date)"
Write-Host "- User: $env:USERNAME"
Write-Host "- PWD: $(Get-Location)"

try {
    $dockerVersion = docker --version 2>$null
    Write-Host "- Docker version: $dockerVersion"
} catch {
    Write-Host "- Docker version: Docker not found" -ForegroundColor Red
}

try {
    $composeVersion = docker compose version 2>$null
    Write-Host "- Docker Compose version: $composeVersion"
} catch {
    Write-Host "- Docker Compose version: Docker Compose not found" -ForegroundColor Red
}

Write-Host ""
Write-Host "🔗 Network Status:" -ForegroundColor Yellow
Write-Host "- Docker networks:"
try {
    $networks = docker network ls | Select-String -Pattern "(govconnect|infra)"
    if ($networks) {
        $networks | ForEach-Object { Write-Host "  $_" }
    } else {
        Write-Host "  No govconnect/infra networks found" -ForegroundColor Yellow
    }
} catch {
    Write-Host "  Error checking networks" -ForegroundColor Red
}

Write-Host ""
Write-Host "📦 Container Status:" -ForegroundColor Yellow
try {
    docker compose ps 2>$null
} catch {
    Write-Host "No containers running" -ForegroundColor Yellow
}

Write-Host ""
Write-Host "🖼️ Image Status:" -ForegroundColor Yellow
Write-Host "- Local images:"
try {
    $images = docker images | Select-String -Pattern "govconnect"
    if ($images) {
        $images | ForEach-Object { Write-Host "  $_" }
    } else {
        Write-Host "  No govconnect images found" -ForegroundColor Yellow
    }
} catch {
    Write-Host "  Error checking images" -ForegroundColor Red
}

Write-Host ""
Write-Host "🔍 Environment Check:" -ForegroundColor Yellow
if (Test-Path ".env") {
    Write-Host "✅ .env file exists" -ForegroundColor Green
    $envCount = (Get-Content ".env" | Where-Object { $_ -match "^[^#]" }).Count
    Write-Host "- Environment variables count: $envCount"
} else {
    Write-Host "❌ .env file missing" -ForegroundColor Red
}

Write-Host ""
Write-Host "🔧 Docker Compose Validation:" -ForegroundColor Yellow
try {
    docker compose config >$null 2>&1
    Write-Host "✅ docker-compose.yml is valid" -ForegroundColor Green
} catch {
    Write-Host "❌ docker-compose.yml has errors:" -ForegroundColor Red
    docker compose config 2>&1
}

Write-Host ""
Write-Host "📝 Recent Logs (last 50 lines):" -ForegroundColor Yellow
Write-Host "================================" -ForegroundColor Yellow
try {
    docker compose logs --tail=50 2>$null
} catch {
    Write-Host "No logs available" -ForegroundColor Yellow
}

Write-Host ""
Write-Host "🏥 Health Check:" -ForegroundColor Yellow
Write-Host "================" -ForegroundColor Yellow

$services = @(
    @{name="channel-service"; port=3001},
    @{name="ai-service"; port=3002},
    @{name="case-service"; port=3003},
    @{name="notification-service"; port=3004},
    @{name="dashboard"; port=3000}
)

foreach ($service in $services) {
    try {
        $response = Invoke-WebRequest -Uri "http://localhost:$($service.port)/health" -TimeoutSec 5 -UseBasicParsing 2>$null
        Write-Host "✅ $($service.name) (port $($service.port)) - OK" -ForegroundColor Green
    } catch {
        try {
            $response = Invoke-WebRequest -Uri "http://localhost:$($service.port)/" -TimeoutSec 5 -UseBasicParsing 2>$null
            Write-Host "✅ $($service.name) (port $($service.port)) - OK" -ForegroundColor Green
        } catch {
            Write-Host "❌ $($service.name) (port $($service.port)) - FAILED" -ForegroundColor Red
        }
    }
}

Write-Host ""
Write-Host "🔍 Troubleshooting Suggestions:" -ForegroundColor Yellow
Write-Host "===============================" -ForegroundColor Yellow

if (-not (Test-Path ".env")) {
    Write-Host "1. Create .env file: Copy-Item .env.example .env"
}

try {
    $networks = docker network ls | Select-String -Pattern "govconnect-network"
    if (-not $networks) {
        Write-Host "2. Create networks: docker network create govconnect-network"
    }
} catch {}

try {
    $networks = docker network ls | Select-String -Pattern "infra-network"
    if (-not $networks) {
        Write-Host "3. Create networks: docker network create infra-network"
    }
} catch {}

try {
    $running = docker compose ps | Select-String -Pattern "running"
    if (-not $running) {
        Write-Host "4. Start services: docker compose up -d"
    }
} catch {}

Write-Host "5. Check logs: docker compose logs -f [service-name]"
Write-Host "6. Rebuild images: docker compose build --no-cache"
Write-Host "7. Reset everything: docker compose down && docker compose up -d --build"

Write-Host ""
Write-Host "✅ Debug script completed!" -ForegroundColor Green