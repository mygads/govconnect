#!/bin/bash
# Setup pg_hba.conf for development environment
# This runs during container initialization

set -e

echo "🔧 Configuring pg_hba.conf for development..."

# Backup original
cp /var/lib/postgresql/data/pg_hba.conf /var/lib/postgresql/data/pg_hba.conf.backup

# Write new pg_hba.conf with scram-sha-256 authentication
cat > /var/lib/postgresql/data/pg_hba.conf << 'EOF'
# PostgreSQL Client Authentication Configuration File
# GovConnect Development Environment
# TYPE  DATABASE        USER            ADDRESS                 METHOD

# "local" is for Unix domain socket connections only
local   all             all                                     trust

# IPv4 local connections (Windows host)
host    all             all             127.0.0.1/32            scram-sha-256

# IPv6 local connections (Windows host)  
host    all             all             ::1/128                 scram-sha-256

# Docker network connections
host    all             all             172.0.0.0/8             scram-sha-256
host    all             all             192.168.0.0/16          scram-sha-256
host    all             all             10.0.0.0/8              scram-sha-256

# Allow from any host (development only)
host    all             all             0.0.0.0/0               scram-sha-256
EOF

echo "✅ pg_hba.conf configured successfully"
echo "📋 Contents:"
cat /var/lib/postgresql/data/pg_hba.conf

# Reload PostgreSQL configuration
psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" -c "SELECT pg_reload_conf();"

echo "✅ PostgreSQL configuration reloaded"
