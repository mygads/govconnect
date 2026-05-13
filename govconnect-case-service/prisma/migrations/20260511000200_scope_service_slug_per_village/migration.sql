DROP INDEX IF EXISTS "services_dynamic_slug_key";
CREATE UNIQUE INDEX "services_dynamic_village_id_slug_key" ON "services_dynamic"("village_id", "slug");
