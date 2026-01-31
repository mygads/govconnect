# 🔒 Docker Security Guidelines

## Security Improvements Applied

### ✅ **Fixed Security Issues**

1. **Consistent Node.js Version**
   - All services now use `node:22-alpine` (LTS version)
   - Consistent base image reduces attack surface

2. **Non-Root User Implementation**
   - All containers run as non-root users:
     - Dashboard: `nextjs` (uid: 1001)
     - Channel: `channeluser` (uid: 1001)
     - AI: `aiuser` (uid: 1001)
     - Case: `caseuser` (uid: 1001)
     - Notification: `notificationuser` (uid: 1001)

3. **Multi-Stage Build Optimization**
   - All Dockerfiles use 3-stage builds:
     - `deps`: Install dependencies
     - `builder`: Build application
     - `runner`: Production runtime
   - Reduces final image size and attack surface

4. **Package Manager Security**
   - Use `corepack` for consistent pnpm version
   - `--frozen-lockfile` ensures reproducible builds
   - Production-only dependencies in final stage

5. **Proper Error Handling**
   - Enhanced entrypoint scripts with `set -e`
   - Graceful fallback for database operations
   - Comprehensive logging for debugging

6. **Health Checks**
   - All services have proper health checks
   - Consistent timeout and retry settings
   - Uses `wget` instead of `curl` (smaller footprint)

## Security Checklist

### 🔍 **Pre-Deployment Validation**

```bash
# Run security validation script
./scripts/validate-docker-security.sh

# Check for vulnerabilities
docker scout cves govconnect-dashboard:latest
docker scout cves govconnect-channel-service:latest
docker scout cves govconnect-ai-service:latest
docker scout cves govconnect-case-service:latest
docker scout cves govconnect-notification-service:latest
```

### 📋 **Security Standards**

#### ✅ **Base Image Security**
- [ ] Use official Alpine Linux images
- [ ] Pin specific Node.js version (22-alpine)
- [ ] Minimal base image (Alpine vs Ubuntu)
- [ ] Regular base image updates

#### ✅ **User Security**
- [ ] Create non-root user in all containers
- [ ] Use consistent UID/GID (1001)
- [ ] Proper file permissions
- [ ] No sudo/root access in runtime

#### ✅ **Build Security**
- [ ] Multi-stage builds to reduce attack surface
- [ ] Remove build dependencies from final image
- [ ] Use .dockerignore to exclude sensitive files
- [ ] Verify package integrity with lock files

#### ✅ **Runtime Security**
- [ ] Run containers as non-root
- [ ] Proper entrypoint scripts with error handling
- [ ] Health checks for all services
- [ ] Resource limits in docker-compose

#### ✅ **Network Security**
- [ ] Use custom networks (not default bridge)
- [ ] Expose only necessary ports
- [ ] Internal service communication
- [ ] No privileged containers

#### ✅ **Data Security**
- [ ] Proper volume permissions
- [ ] No sensitive data in images
- [ ] Environment variable validation
- [ ] Secure database connections

## Security Best Practices

### 1. **Image Scanning**
```bash
# Scan for vulnerabilities before deployment
docker scout cves <image-name>
docker scout recommendations <image-name>

# Use Trivy for additional scanning
trivy image <image-name>
```

### 2. **Runtime Security**
```bash
# Run with security options
docker run --security-opt=no-new-privileges \
           --read-only \
           --tmpfs /tmp \
           --user 1001:1001 \
           <image-name>
```

### 3. **Resource Limits**
```yaml
# In docker-compose.yml
services:
  service-name:
    deploy:
      resources:
        limits:
          memory: 512M
          cpus: '0.5'
        reservations:
          memory: 256M
          cpus: '0.25'
```

### 4. **Network Isolation**
```yaml
# Use custom networks
networks:
  govconnect-network:
    driver: bridge
    internal: true  # No external access
```

## Vulnerability Management

### 1. **Regular Updates**
```bash
# Update base images monthly
docker pull node:22-alpine
docker build --no-cache -t service-name .

# Update dependencies
pnpm update
npm audit fix
```

### 2. **Monitoring**
```bash
# Monitor running containers
docker stats
docker logs --tail 100 container-name

# Check for security events
journalctl -u docker.service
```

### 3. **Incident Response**
```bash
# Emergency container stop
docker stop container-name

# Investigate compromised container
docker exec -it container-name sh
docker inspect container-name
```

## Compliance Requirements

### 1. **OWASP Container Security**
- [ ] Use minimal base images
- [ ] Scan images for vulnerabilities
- [ ] Don't run as root
- [ ] Use read-only filesystems where possible
- [ ] Implement proper logging

### 2. **CIS Docker Benchmark**
- [ ] Enable Docker Content Trust
- [ ] Use user namespaces
- [ ] Limit container resources
- [ ] Enable audit logging
- [ ] Secure Docker daemon

### 3. **Production Hardening**
- [ ] Remove shell access in production images
- [ ] Use distroless images where possible
- [ ] Implement image signing
- [ ] Regular security assessments
- [ ] Automated vulnerability scanning

## Emergency Procedures

### 1. **Security Incident**
```bash
# Immediate response
docker stop $(docker ps -q)  # Stop all containers
docker network disconnect bridge container-name

# Investigation
docker logs container-name > incident-logs.txt
docker inspect container-name > container-details.txt
```

### 2. **Vulnerability Disclosure**
```bash
# Update affected images immediately
docker build --no-cache -t service-name:patched .
docker tag service-name:patched service-name:latest

# Deploy security patch
docker-compose up -d --force-recreate
```

### 3. **Recovery**
```bash
# Clean deployment
docker system prune -af
docker-compose down -v
docker-compose up -d --build
```

## Security Contacts

- **Security Team**: security@govconnect.my.id
- **DevOps Team**: devops@govconnect.my.id
- **Emergency**: +62-xxx-xxx-xxxx

## References

- [OWASP Container Security](https://owasp.org/www-project-container-security/)
- [CIS Docker Benchmark](https://www.cisecurity.org/benchmark/docker)
- [Docker Security Best Practices](https://docs.docker.com/engine/security/)
- [Node.js Security Best Practices](https://nodejs.org/en/docs/guides/security/)