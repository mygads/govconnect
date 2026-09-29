/**
 * R4: village-scoped SKILL.md loader with progressive disclosure.
 *
 * - L1 (index): getSkillIndex(villageId) → [{slug, title, description}] for
 *   ACTIVE skills only. Injected into the prompt's dynamic context on
 *   INFORMATION/COLLECT stages — a few lines, not full procedures.
 * - L2 (full): loadSkill(villageId, slug) → full SKILL.md, via the
 *   load_skill tool (G0, read-only) or the admin API.
 *
 * Tenant isolation: every query is scoped by village_id. Skills are built
 * INACTIVE and need explicit human activation (no auto-promote, P14).
 */
import prisma from '../lib/prisma';
import logger from '../utils/logger';
import { buildSkillMarkdown } from './skill-format';

export interface SkillIndexEntry {
  slug: string;
  title: string;
  description: string;
}

export interface LoadedSkill extends SkillIndexEntry {
  contentMd: string;
  version: number;
}

function rowToIndex(r: { slug: string; title: string; description: string }): SkillIndexEntry {
  return { slug: String(r.slug), title: String(r.title), description: String(r.description) };
}

/**
 * L1: active skill index for a village. Fail-soft: [] when the DB is down
 * so a DB outage degrades to "no skills", never a broken turn.
 */
export async function getSkillIndex(villageId: string): Promise<SkillIndexEntry[]> {
  if (!villageId) return [];
  try {
    const rows = (await prisma.$queryRawUnsafe(
      `SELECT slug, title, description FROM ai.village_skills
       WHERE village_id = $1 AND is_active = TRUE
       ORDER BY slug ASC LIMIT 50`,
      villageId,
    )) as Array<{ slug: string; title: string; description: string }>;
    return rows.map(rowToIndex);
  } catch (err) {
    logger.warn('[skill-loader] getSkillIndex failed (fail-soft)', {
      villageId, error: (err as Error)?.message ?? String(err),
    });
    return [];
  }
}

/**
 * L2: load the full SKILL.md for one slug. Active only, village-scoped.
 */
export async function loadSkill(villageId: string, slug: string): Promise<LoadedSkill | null> {
  if (!villageId || !slug) return null;
  const clean = slug.trim().toLowerCase();
  if (!/^[a-z0-9][a-z0-9-]{1,63}$/.test(clean)) return null;
  try {
    const rows = (await prisma.$queryRawUnsafe(
      `SELECT slug, title, description, content_md, version FROM ai.village_skills
       WHERE village_id = $1 AND slug = $2 AND is_active = TRUE
       LIMIT 1`,
      villageId, clean,
    )) as Array<{ slug: string; title: string; description: string; content_md: string; version: number }>;
    if (rows.length === 0) return null;
    const r = rows[0];
    return {
      slug: String(r.slug), title: String(r.title), description: String(r.description),
      contentMd: String(r.content_md), version: Number(r.version),
    };
  } catch (err) {
    logger.warn('[skill-loader] loadSkill failed (fail-soft)', {
      villageId, slug: clean, error: (err as Error)?.message ?? String(err),
    });
    return null;
  }
}

export interface CreateSkillInput {
  villageId: string;
  slug: string;
  title: string;
  description: string;
  body: string;
  triggers?: string[];
  sourceDocumentId?: string;
  createdBy?: string;
}

/**
 * Store a skill as INACTIVE. Activation is a separate explicit human step.
 */
export async function createSkill(input: CreateSkillInput): Promise<{ id: string; slug: string }> {
  const id = `skl_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
  const contentMd = buildSkillMarkdown({
    slug: input.slug, title: input.title, description: input.description, body: input.body,
  });
  await prisma.$executeRawUnsafe(
    `INSERT INTO ai.village_skills
       (id, village_id, slug, title, description, triggers, content_md,
        source_document_id, is_active, created_by)
     VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7,$8,FALSE,$9)
     ON CONFLICT (village_id, slug) DO UPDATE SET
       title = EXCLUDED.title, description = EXCLUDED.description,
       triggers = EXCLUDED.triggers, content_md = EXCLUDED.content_md,
       source_document_id = EXCLUDED.source_document_id,
       version = ai.village_skills.version + 1, updated_at = now()`,
    id, input.villageId, input.slug, input.title, input.description,
    JSON.stringify(input.triggers ?? []), contentMd,
    input.sourceDocumentId ?? null, input.createdBy ?? 'admin',
  );
  return { id, slug: input.slug };
}

/** Explicit human activation/deactivation. Returns false when not found. */
export async function setSkillActive(
  villageId: string, slug: string, active: boolean,
): Promise<boolean> {
  const res = (await prisma.$executeRawUnsafe(
    `UPDATE ai.village_skills SET is_active = $3, updated_at = now()
     WHERE village_id = $1 AND slug = $2`,
    villageId, slug.trim().toLowerCase(), active,
  )) as unknown as number;
  return Number(res) > 0;
}

/** Admin view: one skill regardless of active flag (dashboard review). */
export async function getSkillAdmin(
  villageId: string, slug: string,
): Promise<(LoadedSkill & { isActive: boolean }) | null> {
  if (!villageId || !slug) return null;
  const clean = slug.trim().toLowerCase();
  if (!/^[a-z0-9][a-z0-9-]{1,63}$/.test(clean)) return null;
  const rows = (await prisma.$queryRawUnsafe(
    `SELECT slug, title, description, content_md, version, is_active FROM ai.village_skills
     WHERE village_id = $1 AND slug = $2 LIMIT 1`,
    villageId, clean,
  )) as Array<{ slug: string; title: string; description: string; content_md: string; version: number; is_active: boolean }>;
  if (rows.length === 0) return null;
  const r = rows[0];
  return {
    slug: String(r.slug), title: String(r.title), description: String(r.description),
    contentMd: String(r.content_md), version: Number(r.version), isActive: Boolean(r.is_active),
  };
}

/** Render the L1 index as prompt lines for dynamic context. */
export function renderSkillIndexForPrompt(index: SkillIndexEntry[]): string | null {
  if (index.length === 0) return null;
  const lines = index.map((s) => `- ${s.slug}: ${s.description}`);
  return (
    '[Panduan prosedur desa]\n' +
    lines.join('\n') +
    '\nBila pertanyaan warga butuh tata cara resmi di atas, baca panduan lengkapnya dulu via tool load_skill sebelum menjawab.'
  );
}
