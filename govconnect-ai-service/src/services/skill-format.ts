/**
 * R4: SKILL.md format — pure functions, no DB.
 *
 * Agent Skills format (Anthropic): YAML frontmatter with `name` and
 * `description`, then the markdown procedure body. The description is the
 * Level-1 progressive-disclosure surface shown in the prompt index; the
 * body is Level 2, loaded on demand via the load_skill tool.
 */

export interface SkillDoc {
  slug: string;
  title: string;
  description: string;
  contentMd: string;
}

/** Build a SKILL.md string from parts. */
export function buildSkillMarkdown(skill: Omit<SkillDoc, 'contentMd'> & { body: string }): string {
  const { slug, title, description, body } = skill;
  return `---\nname: ${slug}\ndescription: ${description}\n---\n\n# ${title}\n\n${body.trim()}\n`;
}

/** Parse a SKILL.md string back into parts. Returns null when malformed. */
export function parseSkillMarkdown(md: string): SkillDoc | null {
  const m = /^---\nname:\s*(.+)\ndescription:\s*(.+)\n---\n\n#\s*(.+)\n\n([\s\S]*)$/.exec((md ?? '').trim());
  if (!m) return null;
  const [, slug, description, title, body] = m;
  if (!/^[a-z0-9][a-z0-9-]{1,63}$/.test(slug.trim())) return null;
  return {
    slug: slug.trim(),
    title: title.trim(),
    description: description.trim(),
    contentMd: md.trim() + '\n',
  };
}

/** Deterministic slug from a document title. */
export function slugifySkillTitle(title: string): string {
  const slug = (title ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '')
    .trim()
    .split(/\s+/)
    .slice(0, 4)
    .join('-')
    .replace(/-+/g, '-')
    .slice(0, 64);
  return /^[a-z0-9][a-z0-9-]{1,63}$/.test(slug) ? slug : 'panduan';
}

const STEP_LINE = /^\s*(?:\d+[.)]|[-*])\s+(.+)$/;

/**
 * Deterministically draft a skill from a routed document (R3 route skill/both).
 * Extracts the procedural skeleton (numbered/bulleted steps); the result is
 * a DRAFT stored inactive — a human reviews and activates it.
 */
export function buildSkillFromDocument(input: {
  title: string;
  text: string;
}): { slug: string; title: string; description: string; body: string; triggers: string[] } {
  const title = (input.title ?? '').trim() || 'Panduan Layanan';
  const text = input.text ?? '';
  const slug = slugifySkillTitle(title);

  const steps: string[] = [];
  for (const line of text.split('\n')) {
    const m = STEP_LINE.exec(line);
    if (m && m[1].trim().length > 0) steps.push(m[1].trim());
    if (steps.length >= 20) break;
  }

  const body =
    steps.length > 0
      ? `## Tata cara\n\n${steps.map((s, i) => `${i + 1}. ${s}`).join('\n')}\n`
      : `## Ringkasan\n\n${text.slice(0, 1500).trim()}\n`;

  const description = `Tata cara ${title.toLowerCase().slice(0, 80)}`;

  // Trigger keywords: significant words from the title.
  const triggers = [...new Set(
    title.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').split(/\s+/).filter((w) => w.length >= 4),
  )].slice(0, 8);

  return { slug, title, description, body, triggers };
}

/** Validate a skill draft before it may be stored. */
export function validateSkillDraft(d: { slug: string; title: string; description: string; body: string }): string | null {
  if (!/^[a-z0-9][a-z0-9-]{1,63}$/.test(d.slug)) return 'slug tidak valid';
  if (!d.title.trim()) return 'title kosong';
  if (!d.description.trim()) return 'description kosong';
  if (!d.body.trim()) return 'body kosong';
  if (isBodyTooLong(d.body)) return 'body terlalu panjang';
  return null;
}

// Max ~12k chars per skill body (keeps load_skill responses bounded).
const MAX_BODY = 12_000;
export function isBodyTooLong(body: string): boolean {
  return body.length > MAX_BODY;
}
