#!/bin/bash

# ===================================================================================
# GOVCONNECT - DOCKER SECURITY VALIDATION SCRIPT
# ===================================================================================
# 
# Script untuk validasi keamanan semua Dockerfile
# Usage: ./scripts/validate-docker-security.sh
#
# ===================================================================================

set -e

echo "🔒 GovConnect Docker Security Validation"
echo "========================================"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Counters
PASS=0
FAIL=0
WARN=0

# Function to print status
print_status() {
    local status=$1
    local message=$2
    
    case $status in
        "PASS")
            echo -e "${GREEN}✅ PASS${NC}: $message"
            ((PASS++))
            ;;
        "FAIL")
            echo -e "${RED}❌ FAIL${NC}: $message"
            ((FAIL++))
            ;;
        "WARN")
            echo -e "${YELLOW}⚠️  WARN${NC}: $message"
            ((WARN++))
            ;;
        "INFO")
            echo -e "${BLUE}ℹ️  INFO${NC}: $message"
            ;;
    esac
}

# Check if we're in the right directory
if [ ! -f "docker-compose.yml" ]; then
    print_status "FAIL" "docker-compose.yml not found. Please run from govconnect root directory."
    exit 1
fi

echo ""
echo "🔍 Checking Dockerfile Security..."
echo "=================================="

# Services to check
services=("govconnect-dashboard" "govconnect-channel-service" "govconnect-ai-service" "govconnect-case-service" "govconnect-notification-service")

for service in "${services[@]}"; do
    echo ""
    echo "📦 Checking $service..."
    
    dockerfile="$service/Dockerfile"
    
    if [ ! -f "$dockerfile" ]; then
        print_status "FAIL" "$dockerfile not found"
        continue
    fi
    
    # Check 1: Multi-stage build
    if grep -q "FROM.*AS.*" "$dockerfile"; then
        print_status "PASS" "Multi-stage build detected"
    else
        print_status "FAIL" "No multi-stage build found"
    fi
    
    # Check 2: Non-root user
    if grep -q "adduser\|addgroup" "$dockerfile" && grep -q "USER.*[^0]" "$dockerfile"; then
        print_status "PASS" "Non-root user implementation found"
    else
        print_status "FAIL" "No non-root user found"
    fi
    
    # Check 3: Node.js version consistency
    if grep -q "FROM node:22-alpine" "$dockerfile"; then
        print_status "PASS" "Using consistent Node.js 22-alpine"
    elif grep -q "FROM node:23-alpine" "$dockerfile"; then
        print_status "WARN" "Using Node.js 23-alpine (should be 22-alpine for consistency)"
    else
        print_status "FAIL" "Not using recommended Node.js version"
    fi
    
    # Check 4: Package manager security
    if grep -q "corepack enable" "$dockerfile" && grep -q "frozen-lockfile" "$dockerfile"; then
        print_status "PASS" "Secure package manager configuration"
    else
        print_status "WARN" "Package manager security could be improved"
    fi
    
    # Check 5: Health check
    if grep -q "HEALTHCHECK" "$dockerfile"; then
        print_status "PASS" "Health check implemented"
    else
        print_status "WARN" "No health check found"
    fi
    
    # Check 6: Proper entrypoint
    if grep -q "entrypoint.sh" "$dockerfile" && grep -q "set -e" "$dockerfile"; then
        print_status "PASS" "Secure entrypoint script with error handling"
    else
        print_status "WARN" "Entrypoint script could be improved"
    fi
    
    # Check 7: No root in CMD/ENTRYPOINT
    if grep -E "CMD.*root|ENTRYPOINT.*root" "$dockerfile"; then
        print_status "FAIL" "Running as root in CMD/ENTRYPOINT"
    else
        print_status "PASS" "No root execution in CMD/ENTRYPOINT"
    fi
    
    # Check 8: Proper file permissions
    if grep -q "chown.*nodejs" "$dockerfile"; then
        print_status "PASS" "Proper file ownership configuration"
    else
        print_status "WARN" "File ownership could be improved"
    fi
    
    # Check 9: Production environment
    if grep -q "NODE_ENV=production" "$dockerfile"; then
        print_status "PASS" "Production environment set"
    else
        print_status "WARN" "NODE_ENV=production not explicitly set"
    fi
    
    # Check 10: No sensitive data
    if grep -iE "password|secret|key|token" "$dockerfile" | grep -v "dummy\|example\|placeholder"; then
        print_status "FAIL" "Potential sensitive data in Dockerfile"
    else
        print_status "PASS" "No sensitive data detected in Dockerfile"
    fi
done

echo ""
echo "🔍 Checking docker-compose.yml Security..."
echo "=========================================="

compose_file="docker-compose.yml"

# Check 1: Custom networks
if grep -q "networks:" "$compose_file" && grep -q "govconnect-network" "$compose_file"; then
    print_status "PASS" "Custom networks configured"
else
    print_status "WARN" "Using default Docker network"
fi

# Check 2: Port binding security
if grep -q "127.0.0.1:" "$compose_file"; then
    print_status "PASS" "Ports bound to localhost only"
else
    print_status "WARN" "Ports may be exposed to all interfaces"
fi

# Check 3: Environment file usage
if grep -q "env_file:" "$compose_file"; then
    print_status "PASS" "Environment files used"
else
    print_status "WARN" "No environment files configured"
fi

# Check 4: Health checks in compose
if grep -q "healthcheck:" "$compose_file"; then
    print_status "PASS" "Health checks in docker-compose"
else
    print_status "WARN" "No health checks in docker-compose"
fi

# Check 5: Restart policies
if grep -q "restart:" "$compose_file"; then
    print_status "PASS" "Restart policies configured"
else
    print_status "WARN" "No restart policies found"
fi

echo ""
echo "🔍 Checking Environment Security..."
echo "================================="

# Check .env.example
if [ -f ".env.example" ]; then
    print_status "PASS" ".env.example file exists"
    
    # Check for sensitive data in example
    if grep -iE "password.*=.*[^example]|secret.*=.*[^your_]|key.*=.*[^your_]" ".env.example"; then
        print_status "WARN" "Potential real credentials in .env.example"
    else
        print_status "PASS" "No real credentials in .env.example"
    fi
else
    print_status "WARN" ".env.example file missing"
fi

# Check .env file
if [ -f ".env" ]; then
    print_status "INFO" ".env file exists (good for local dev)"
    
    # Check if .env is in .gitignore
    if [ -f ".gitignore" ] && grep -q "\.env" ".gitignore"; then
        print_status "PASS" ".env file is in .gitignore"
    else
        print_status "FAIL" ".env file not in .gitignore - SECURITY RISK!"
    fi
else
    print_status "INFO" ".env file not found (normal for production)"
fi

echo ""
echo "🔍 Checking .dockerignore Files..."
echo "================================="

for service in "${services[@]}"; do
    dockerignore="$service/.dockerignore"
    if [ -f "$dockerignore" ]; then
        print_status "PASS" "$service has .dockerignore"
        
        # Check for common exclusions
        if grep -q "node_modules\|\.git\|\.env" "$dockerignore"; then
            print_status "PASS" "$service .dockerignore excludes sensitive files"
        else
            print_status "WARN" "$service .dockerignore could exclude more files"
        fi
    else
        print_status "WARN" "$service missing .dockerignore file"
    fi
done

echo ""
echo "🔍 Security Recommendations..."
echo "============================="

echo ""
echo "📋 Additional Security Measures:"
echo "1. Regular vulnerability scanning: docker scout cves <image>"
echo "2. Image signing for production deployments"
echo "3. Runtime security monitoring"
echo "4. Regular base image updates"
echo "5. Implement secrets management (Docker Secrets/Kubernetes Secrets)"
echo "6. Network segmentation in production"
echo "7. Regular security audits"

echo ""
echo "🔧 Quick Fixes:"
if [ $FAIL -gt 0 ]; then
    echo "- Fix FAILED checks above before deployment"
fi
if [ $WARN -gt 0 ]; then
    echo "- Address WARNING items for better security"
fi
echo "- Run: docker scout cves <image> for vulnerability scanning"
echo "- Run: ./scripts/debug-deployment.sh for deployment validation"

echo ""
echo "📊 Security Validation Summary"
echo "============================="
echo -e "${GREEN}✅ PASSED: $PASS${NC}"
echo -e "${YELLOW}⚠️  WARNINGS: $WARN${NC}"
echo -e "${RED}❌ FAILED: $FAIL${NC}"

if [ $FAIL -eq 0 ]; then
    echo ""
    echo -e "${GREEN}🎉 Security validation completed successfully!${NC}"
    echo "All critical security checks passed."
    exit 0
else
    echo ""
    echo -e "${RED}🚨 Security validation failed!${NC}"
    echo "Please fix the failed checks before deployment."
    exit 1
fi