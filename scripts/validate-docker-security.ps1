# ===================================================================================
# GOVCONNECT - DOCKER SECURITY VALIDATION SCRIPT (PowerShell)
# ===================================================================================
# 
# Script untuk validasi keamanan semua Dockerfile di Windows
# Usage: .\scripts\validate-docker-security.ps1
#
# ===================================================================================

Write-Host "🔒 GovConnect Docker Security Validation" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan

# Counters
$PASS = 0
$FAIL = 0
$WARN = 0

# Function to print status
function Print-Status {
    param(
        [string]$Status,
        [string]$Message
    )
    
    switch ($Status) {
        "PASS" {
            Write-Host "✅ PASS: $Message" -ForegroundColor Green
            $script:PASS++
        }
        "FAIL" {
            Write-Host "❌ FAIL: $Message" -ForegroundColor Red
            $script:FAIL++
        }
        "WARN" {
            Write-Host "⚠️  WARN: $Message" -ForegroundColor Yellow
            $script:WARN++
        }
        "INFO" {
            Write-Host "ℹ️  INFO: $Message" -ForegroundColor Blue
        }
    }
}

# Check if we're in the right directory
if (-not (Test-Path "docker-compose.yml")) {
    Print-Status "FAIL" "docker-compose.yml not found. Please run from govconnect root directory."
    exit 1
}

Write-Host ""
Write-Host "🔍 Checking Dockerfile Security..." -ForegroundColor Yellow
Write-Host "==================================" -ForegroundColor Yellow

# Services to check
$services = @("govconnect-dashboard", "govconnect-channel-service", "govconnect-ai-service", "govconnect-case-service", "govconnect-notification-service")

foreach ($service in $services) {
    Write-Host ""
    Write-Host "📦 Checking $service..." -ForegroundColor Cyan
    
    $dockerfile = "$service\Dockerfile"
    
    if (-not (Test-Path $dockerfile)) {
        Print-Status "FAIL" "$dockerfile not found"
        continue
    }
    
    $content = Get-Content $dockerfile -Raw
    
    # Check 1: Multi-stage build
    if ($content -match "FROM.*AS.*") {
        Print-Status "PASS" "Multi-stage build detected"
    } else {
        Print-Status "FAIL" "No multi-stage build found"
    }
    
    # Check 2: Non-root user
    if ($content -match "adduser|addgroup" -and $content -match "USER.*[^0]") {
        Print-Status "PASS" "Non-root user implementation found"
    } else {
        Print-Status "FAIL" "No non-root user found"
    }
    
    # Check 3: Node.js version consistency
    if ($content -match "FROM node:22-alpine") {
        Print-Status "PASS" "Using consistent Node.js 22-alpine"
    } elseif ($content -match "FROM node:23-alpine") {
        Print-Status "WARN" "Using Node.js 23-alpine (should be 22-alpine for consistency)"
    } else {
        Print-Status "FAIL" "Not using recommended Node.js version"
    }
    
    # Check 4: Package manager security
    if ($content -match "corepack enable" -and $content -match "frozen-lockfile") {
        Print-Status "PASS" "Secure package manager configuration"
    } else {
        Print-Status "WARN" "Package manager security could be improved"
    }
    
    # Check 5: Health check
    if ($content -match "HEALTHCHECK") {
        Print-Status "PASS" "Health check implemented"
    } else {
        Print-Status "WARN" "No health check found"
    }
    
    # Check 6: Proper entrypoint
    if ($content -match "entrypoint.sh" -and $content -match "set -e") {
        Print-Status "PASS" "Secure entrypoint script with error handling"
    } else {
        Print-Status "WARN" "Entrypoint script could be improved"
    }
    
    # Check 7: No root in CMD/ENTRYPOINT
    if ($content -match "CMD.*root|ENTRYPOINT.*root") {
        Print-Status "FAIL" "Running as root in CMD/ENTRYPOINT"
    } else {
        Print-Status "PASS" "No root execution in CMD/ENTRYPOINT"
    }
    
    # Check 8: Proper file permissions
    if ($content -match "chown.*nodejs") {
        Print-Status "PASS" "Proper file ownership configuration"
    } else {
        Print-Status "WARN" "File ownership could be improved"
    }
    
    # Check 9: Production environment
    if ($content -match "NODE_ENV=production") {
        Print-Status "PASS" "Production environment set"
    } else {
        Print-Status "WARN" "NODE_ENV=production not explicitly set"
    }
    
    # Check 10: No sensitive data
    $sensitivePattern = "password|secret|key|token"
    $excludePattern = "dummy|example|placeholder"
    $sensitiveMatches = Select-String -Pattern $sensitivePattern -Path $dockerfile -CaseSensitive:$false
    if ($sensitiveMatches) {
        $hasSensitive = $false
        foreach ($match in $sensitiveMatches) {
            if ($match.Line -notmatch $excludePattern) {
                $hasSensitive = $true
                break
            }
        }
        if ($hasSensitive) {
            Print-Status "FAIL" "Potential sensitive data in Dockerfile"
        } else {
            Print-Status "PASS" "No sensitive data detected in Dockerfile"
        }
    } else {
        Print-Status "PASS" "No sensitive data detected in Dockerfile"
    }
}

Write-Host ""
Write-Host "🔍 Checking docker-compose.yml Security..." -ForegroundColor Yellow
Write-Host "=========================================" -ForegroundColor Yellow

$composeFile = "docker-compose.yml"
$composeContent = Get-Content $composeFile -Raw

# Check 1: Custom networks
if ($composeContent -match "networks:" -and $composeContent -match "govconnect-network") {
    Print-Status "PASS" "Custom networks configured"
} else {
    Print-Status "WARN" "Using default Docker network"
}

# Check 2: Port binding security
if ($composeContent -match "127.0.0.1:") {
    Print-Status "PASS" "Ports bound to localhost only"
} else {
    Print-Status "WARN" "Ports may be exposed to all interfaces"
}

# Check 3: Environment file usage
if ($composeContent -match "env_file:") {
    Print-Status "PASS" "Environment files used"
} else {
    Print-Status "WARN" "No environment files configured"
}

# Check 4: Health checks in compose
if ($composeContent -match "healthcheck:") {
    Print-Status "PASS" "Health checks in docker-compose"
} else {
    Print-Status "WARN" "No health checks in docker-compose"
}

# Check 5: Restart policies
if ($composeContent -match "restart:") {
    Print-Status "PASS" "Restart policies configured"
} else {
    Print-Status "WARN" "No restart policies found"
}

Write-Host ""
Write-Host "🔍 Checking Environment Security..." -ForegroundColor Yellow
Write-Host "=================================" -ForegroundColor Yellow

# Check .env.example
if (Test-Path ".env.example") {
    Print-Status "PASS" ".env.example file exists"
    
    $envExampleContent = Get-Content ".env.example" -Raw
    if ($envExampleContent -match "password.*=.*[^example]|secret.*=.*[^your_]|key.*=.*[^your_]") {
        Print-Status "WARN" "Potential real credentials in .env.example"
    } else {
        Print-Status "PASS" "No real credentials in .env.example"
    }
} else {
    Print-Status "WARN" ".env.example file missing"
}

# Check .env file
if (Test-Path ".env") {
    Print-Status "INFO" ".env file exists (good for local dev)"
    
    # Check if .env is in .gitignore
    if ((Test-Path ".gitignore") -and ((Get-Content ".gitignore" -Raw) -match "\.env")) {
        Print-Status "PASS" ".env file is in .gitignore"
    } else {
        Print-Status "FAIL" ".env file not in .gitignore - SECURITY RISK!"
    }
} else {
    Print-Status "INFO" ".env file not found (normal for production)"
}

Write-Host ""
Write-Host "🔍 Checking .dockerignore Files..." -ForegroundColor Yellow
Write-Host "=================================" -ForegroundColor Yellow

foreach ($service in $services) {
    $dockerignore = "$service\.dockerignore"
    if (Test-Path $dockerignore) {
        Print-Status "PASS" "$service has .dockerignore"
        
        $dockerignoreContent = Get-Content $dockerignore -Raw
        if ($dockerignoreContent -match "node_modules|\.git|\.env") {
            Print-Status "PASS" "$service .dockerignore excludes sensitive files"
        } else {
            Print-Status "WARN" "$service .dockerignore could exclude more files"
        }
    } else {
        Print-Status "WARN" "$service missing .dockerignore file"
    }
}

Write-Host ""
Write-Host "🔍 Security Recommendations..." -ForegroundColor Yellow
Write-Host "=============================" -ForegroundColor Yellow

Write-Host ""
Write-Host "📋 Additional Security Measures:"
Write-Host "1. Regular vulnerability scanning: docker scout cves <image>"
Write-Host "2. Image signing for production deployments"
Write-Host "3. Runtime security monitoring"
Write-Host "4. Regular base image updates"
Write-Host "5. Implement secrets management (Docker Secrets/Kubernetes Secrets)"
Write-Host "6. Network segmentation in production"
Write-Host "7. Regular security audits"

Write-Host ""
Write-Host "🔧 Quick Fixes:"
if ($FAIL -gt 0) {
    Write-Host "- Fix FAILED checks above before deployment"
}
if ($WARN -gt 0) {
    Write-Host "- Address WARNING items for better security"
}
Write-Host "- Run: docker scout cves <image> for vulnerability scanning"
Write-Host "- Run: .\scripts\debug-deployment.ps1 for deployment validation"

Write-Host ""
Write-Host "📊 Security Validation Summary" -ForegroundColor Yellow
Write-Host "=============================" -ForegroundColor Yellow
Write-Host "✅ PASSED: $PASS" -ForegroundColor Green
Write-Host "⚠️  WARNINGS: $WARN" -ForegroundColor Yellow
Write-Host "❌ FAILED: $FAIL" -ForegroundColor Red

if ($FAIL -eq 0) {
    Write-Host ""
    Write-Host "🎉 Security validation completed successfully!" -ForegroundColor Green
    Write-Host "All critical security checks passed."
    exit 0
} else {
    Write-Host ""
    Write-Host "🚨 Security validation failed!" -ForegroundColor Red
    Write-Host "Please fix the failed checks before deployment."
    exit 1
}