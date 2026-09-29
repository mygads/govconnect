DROP INDEX IF EXISTS cases."services_dynamic_slug_key";
CREATE UNIQUE INDEX "services_dynamic_village_id_slug_key" ON cases."services_dynamic"("village_id", "slug");
