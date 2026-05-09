# GovConnect repo guidance

## Prisma migration safety
- Every `schema.prisma` change must ship as a standard Prisma migration.
- Never create a loose `.sql` file directly under `prisma/migrations/`.
- Valid structure is `prisma/migrations/<timestamp_name>/migration.sql`.
- If a change truly cannot be represented as a Prisma migration, place the SQL in `scripts/` or another explicit manual-ops location and document why it is manual.
- After creating or editing migrations, run the repo migration validator and the relevant build/typecheck commands.
- If a migration was applied manually in production, keep the SQL in a valid Prisma migration directory and use `prisma migrate resolve --applied <migration_name>` to reconcile history.

## Deploy expectations
- CI/CD already runs `prisma migrate deploy` during deployment.
- That means database changes are only safe when the migration is in Prisma's recognized directory format.
- Treat migration validation failures as blocking issues, not warnings.
