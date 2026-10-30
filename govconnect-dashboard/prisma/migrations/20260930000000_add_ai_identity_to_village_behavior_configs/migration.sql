-- Identitas AI per desa: disclosure toggle + nama persona + deskripsi persona.
-- Default disclosure=true (transparan: "asisten AI resmi, bukan petugas manusia").
ALTER TABLE "village_behavior_configs"
  ADD COLUMN IF NOT EXISTS "ai_identity_disclosure" BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS "ai_persona_name" TEXT NOT NULL DEFAULT 'Gana',
  ADD COLUMN IF NOT EXISTS "ai_persona_description" TEXT;
