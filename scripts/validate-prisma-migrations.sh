#!/usr/bin/env bash
set -euo pipefail

printf '🔍 Validating Prisma migration layout\n'

repo_root="$(cd "$(dirname "$0")/.." && pwd)"
cd "$repo_root"

violations=()

while IFS= read -r -d '' migrations_dir; do
  while IFS= read -r -d '' loose_sql; do
    violations+=("${loose_sql#./}")
  done < <(find "$migrations_dir" -maxdepth 1 -type f -name '*.sql' -print0)
done < <(find . -type d -path '*/prisma/migrations' -print0)

if [ "${#violations[@]}" -gt 0 ]; then
  printf '❌ Found SQL files directly under prisma/migrations/.\n'
  printf 'Prisma only applies migrations in subdirectories like prisma/migrations/<timestamp_name>/migration.sql.\n\n'
  printf 'Files to fix:\n'
  for path in "${violations[@]}"; do
    printf '  - %s\n' "$path"
  done
  printf '\nExample valid structure:\n'
  printf '  govconnect-dashboard/prisma/migrations/20260509000000_add_village_timezone/migration.sql\n'
  exit 1
fi

printf '✅ Prisma migration layout looks valid.\n'
