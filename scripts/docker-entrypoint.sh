#!/bin/sh
# ===================================================================================
# STRICT AUTO-MIGRATION ENTRYPOINT SCRIPT
# ===================================================================================
#
# Runs Prisma migrations before starting the application. Migration problems are
# deployment failures: this script never falls back to schema push and never starts the
# app after a failed migration.
#
# Behaviour:
# 1. Require DATABASE_URL so Prisma can connect to the target database.
# 2. Wait for the database to accept queries.
# 3. Require prisma/migrations to exist and contain migration SQL.
# 4. Run prisma migrate deploy.
# 5. Start the application only after migrations succeed.
#
# ===================================================================================

set -e

run_prisma() {
    if [ -x "./node_modules/.bin/prisma" ]; then
        ./node_modules/.bin/prisma "$@"
    else
        npx prisma "$@"
    fi
}

echo "=================================================="
echo "Starting strict auto-migration process"
echo "=================================================="

if [ -z "${DATABASE_URL:-}" ]; then
    echo "ERROR: DATABASE_URL is not set; refusing to start without running migrations"
    exit 1
fi

# Wait for database to be ready
echo "Waiting for database connection..."
MAX_RETRIES=30
RETRY_COUNT=0

while [ "$RETRY_COUNT" -lt "$MAX_RETRIES" ]; do
    if printf 'SELECT 1;\n' | run_prisma db execute --stdin >/dev/null 2>&1; then
        echo "Database is ready"
        break
    fi

    RETRY_COUNT=$((RETRY_COUNT + 1))
    echo "Attempt $RETRY_COUNT/$MAX_RETRIES - database not ready, waiting..."
    sleep 2
done

if [ "$RETRY_COUNT" -eq "$MAX_RETRIES" ]; then
    echo "ERROR: Could not connect to database after $MAX_RETRIES attempts"
    exit 1
fi

# Run migration
echo "Running database migrations..."

if [ ! -d "prisma/migrations" ] || [ -z "$(ls -A prisma/migrations 2>/dev/null)" ]; then
    echo "ERROR: Prisma migrations missing from image; refusing to start"
    exit 1
fi

run_prisma migrate deploy

echo "Migrations completed successfully"
echo "=================================================="
echo "Starting application"
echo "=================================================="

exec "$@"
