/**
 * R4: SKILL.md format — pure unit tests.
 */
import { describe, it, expect } from 'vitest';
import {
  buildSkillMarkdown,
  parseSkillMarkdown,
  slugifySkillTitle,
  buildSkillFromDocument,
  validateSkillDraft,
  isBodyTooLong,
} from '../skill-format';

describe('buildSkillMarkdown / parseSkillMarkdown', () => {
  it('round-trips', () => {
    const md = buildSkillMarkdown({
      slug: 'sktm',
      title: 'SKTM',
      description: 'Tata cara mengurus SKTM',
      body: '## Tata cara\n\n1. Bawa KTP\n',
    });
    expect(md).toContain('name: sktm');
    const parsed = parseSkillMarkdown(md);
    expect(parsed?.slug).toBe('sktm');
    expect(parsed?.title).toBe('SKTM');
    expect(parsed?.description).toBe('Tata cara mengurus SKTM');
    expect(parsed?.contentMd).toContain('Bawa KTP');
  });

  it('rejects malformed markdown', () => {
    expect(parseSkillMarkdown('no frontmatter')).toBeNull();
    expect(parseSkillMarkdown('---\nname: BAD SLUG!\ndescription: x\n---\n\n# T\n\nb\n')).toBeNull();
  });
});

describe('slugifySkillTitle', () => {
  it('slugifies Indonesian titles', () => {
    expect(slugifySkillTitle('Syarat & Tata Cara SKTM 2026!')).toBe('syarat-tata-cara-sktm');
  });

  it('falls back for empty/garbage input', () => {
    expect(slugifySkillTitle('')).toBe('panduan');
    expect(slugifySkillTitle('!!!')).toBe('panduan');
  });
});

describe('buildSkillFromDocument', () => {
  it('extracts numbered steps deterministically', () => {
    const d = buildSkillFromDocument({
      title: 'SKTM',
      text: 'Pengantar.\n1. Fotokopi KTP\n2. Surat pengantar RT\n3) Isi formulir\n\nPenutup.',
    });
    expect(d.slug).toBe('sktm');
    expect(d.body).toContain('1. Fotokopi KTP');
    expect(d.body).toContain('3. Isi formulir');
    expect(d.body).not.toContain('Pengantar.');
    expect(d.triggers).toContain('sktm');
  });

  it('falls back to a summary when there are no steps', () => {
    const d = buildSkillFromDocument({ title: 'Info', text: 'Paragraf biasa tanpa langkah.' });
    expect(d.body).toContain('Paragraf biasa');
  });

  it('is deterministic', () => {
    const input = { title: 'SKTM', text: '1. A\n2. B\n' };
    expect(buildSkillFromDocument(input)).toEqual(buildSkillFromDocument(input));
  });
});

describe('validateSkillDraft', () => {
  const good = { slug: 'sktm', title: 'SKTM', description: 'd', body: 'b' };
  it('accepts a good draft', () => {
    expect(validateSkillDraft(good)).toBeNull();
  });
  it('rejects bad slugs and empty fields', () => {
    expect(validateSkillDraft({ ...good, slug: 'BAD' })).toBe('slug tidak valid');
    expect(validateSkillDraft({ ...good, title: ' ' })).toBe('title kosong');
    expect(validateSkillDraft({ ...good, body: '' })).toBe('body kosong');
  });
  it('rejects oversized bodies', () => {
    expect(isBodyTooLong('x'.repeat(12_001))).toBe(true);
    expect(isBodyTooLong('x'.repeat(100))).toBe(false);
    expect(validateSkillDraft({ ...good, body: 'x'.repeat(12_001) })).toBe('body terlalu panjang');
  });
});
