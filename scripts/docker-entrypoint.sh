#!/bin/sh
# ===================================================================================
# AUTO-MIGRATION ENTRYPOINT SCRIPT
# ===================================================================================
# 
# Script ini menjalankan database migration secara otomatis saat container start.
# Jika ada conflict, migration tidak akan dijalankan dan service akan tetap start.
#
# Behaviour:
# 1. Jika ada folder prisma/migrations → gunakan prisma migrate deploy
# 2. Jika tidak ada migrations folder → gunakan prisma db push
# 3. Jika migration gagal (conflict) → log error, tetap start service
# 4. Jika migration sukses → start service
#
# ===================================================================================

set -e

echo "=================================================="
echo "🚀 Starting Auto-Migration Process"
echo "=================================================="

# Wait for database to be ready
echo "⏳ Waiting for database connection..."
MAX_RETRIES=30
RETRY_COUNT=0

while [ $RETRY_COUNT -lt $MAX_RETRIES ]; do
    if npx prisma db execute --stdin <<< "SELECT 1" 2>/dev/null; then
        echo "✅ Database is ready!"
        break
    fi
    RETRY_COUNT=$((RETRY_COUNT + 1))
    echo "   Attempt $RETRY_COUNT/$MAX_RETRIES - Database not ready, waiting..."
    sleep 2
done

if [ $RETRY_COUNT -eq $MAX_RETRIES ]; then
    echo "⚠️  Warning: Could not connect to database after $MAX_RETRIES attempts"
    echo "   Proceeding without migration..."
    exec "$@"
fi

# Run migration
echo "🔄 Running database migration..."

if [ -d "prisma/migrations" ] && [ "$(ls -A prisma/migrations 2>/dev/null)" ]; then
    echo "   Found migrations folder, using 'prisma migrate deploy'"
    
    if npx prisma migrate deploy 2>&1; then
        echo "✅ Migration completed successfully!"
    else
        EXIT_CODE=$?
        echo "⚠️  Migration failed with exit code $EXIT_CODE"
        echo "   This might be due to:"
        echo "   - Schema conflicts requiring manual resolution"
        echo "   - Database already has incompatible schema"
        echo "   Please run migrations manually if needed."
        echo ""
        echo "   Proceeding to start service anyway..."
    fi
else
    echo "   No migrations folder found, using 'prisma db push'"
    
    if npx prisma db push --accept-data-loss 2>&1; then
        echo "✅ Schema push completed successfully!"
    else
        EXIT_CODE=$?
        echo "⚠️  Schema push failed with exit code $EXIT_CODE"
        echo "   This might be due to:"
        echo "   - Schema conflicts requiring manual resolution"
        echo "   - Database already has incompatible schema"
        echo "   Please run 'prisma db push' manually if needed."
        echo ""
        echo "   Proceeding to start service anyway..."
    fi
fi

echo "=================================================="
echo "🎉 Starting application..."
echo "=================================================="

# Execute the main command
exec "$@"
