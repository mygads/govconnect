/**
 * Consistency entity extractor.
 *
 * Hybrid: regex-first, LLM fallback when regex returns ambiguous results.
 * Pulls structured facts (phone numbers, operating hours, addresses,
 * role holders, service requirements) out of a document chunk so the
 * doc-vs-db pipeline can cross-check them against DB ground truth.
 *
 * Regex is free and deterministic — it handles "kepala desa: Bapak Heru"
 * or "0271-123456" directly. LLM is only invoked when regex finds a
 * partial match that needs disambiguation (e.g., multi-role paragraphs
 * or implied entities).
 */

import logger from '../utils/logger';
import { buildPromptMessages, callAIGatewayPrompt, isAIGatewayEnabledAsync } from './ai-gateway.service';

export type ExtractedEntityKind =
  | 'phone_number'
  | 'operating_hours'
  | 'address'
  | 'office_role_holder'
  | 'service_requirement_item';

export interface ExtractedEntity {
  kind: ExtractedEntityKind;
  value: string;
  /** For role holders: the role (e.g., "kepala desa"). For phones: the entity the number belongs to. */
  subject?: string;
  /** 0..1 how confident we are in this extraction. */
  confidence: number;
  source: 'regex' | 'llm';
}

const PHONE_REGEX = /\b(?:\+?62|0)\d{2,3}[-.\s]?\d{3,4}[-.\s]?\d{3,4}\b/g;
const TIME_REGEX = /\b\d{1,2}[:.]\d{2}(?:\s*(?:s[.]?d[.]?|sampai|sd|-|–)\s*\d{1,2}[:.]\d{2})?\b/gi;
const ADDRESS_REGEX = /\b(?:jl|jalan)\.?\s+[A-Za-z0-9.\-\s]{3,}(?:no\.?\s*\d+)?(?:\s*,\s*rt\s*\d+(?:\/\d+)?)?\b/gi;

const ROLE_REGEX = /\b(kepala\s+desa|kades|lurah|sekretaris\s+desa|sekdes|ketua\s+rt(?:\s*\d+)?|ketua\s+rw(?:\s*\d+)?|camat)\b[^.\n]*?[:\-]\s*([A-Z][a-zA-Z\s.]{3,50})/gi;

function normalizeWhitespace(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

function extractRegex(content: string): ExtractedEntity[] {
  const out: ExtractedEntity[] = [];
  const seen = new Set<string>();

  for (const match of content.matchAll(PHONE_REGEX)) {
    const value = match[0];
    const key = `phone_number:${value}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const subjectWindow = content.substring(Math.max(0, match.index! - 60), match.index!).trim();
    const subjectMatch = subjectWindow.match(/([A-Z][a-zA-Z\s]{2,40})\s*[:\-]?\s*$/);
    out.push({
      kind: 'phone_number',
      value,
      subject: subjectMatch ? normalizeWhitespace(subjectMatch[1]) : undefined,
      confidence: 0.9,
      source: 'regex',
    });
  }

  for (const match of content.matchAll(TIME_REGEX)) {
    const value = normalizeWhitespace(match[0]);
    const key = `operating_hours:${value}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({
      kind: 'operating_hours',
      value,
      confidence: value.includes('-') || /s[.]?d[.]?/i.test(value) ? 0.85 : 0.6,
      source: 'regex',
    });
  }

  for (const match of content.matchAll(ADDRESS_REGEX)) {
    const value = normalizeWhitespace(match[0]);
    const key = `address:${value.toLowerCase()}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({
      kind: 'address',
      value,
      confidence: 0.7,
      source: 'regex',
    });
  }

  for (const match of content.matchAll(ROLE_REGEX)) {
    const role = normalizeWhitespace(match[1]);
    const holder = normalizeWhitespace(match[2]);
    const key = `role:${role.toLowerCase()}:${holder.toLowerCase()}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({
      kind: 'office_role_holder',
      value: holder,
      subject: role,
      confidence: 0.75,
      source: 'regex',
    });
  }

  return out;
}

const LLM_EXTRACT_PROMPT = `Kamu adalah entity extractor untuk dokumen layanan desa.
Ekstrak fakta terstruktur berikut dari TEKS di bawah. Hanya ekstrak yang JELAS tertulis. JANGAN tebak.

Kembalikan JSON array dengan item berbentuk:
{"kind": "<phone_number|operating_hours|address|office_role_holder|service_requirement_item>", "value": "<nilai>", "subject": "<opsional, mis. nama peran atau entitas pemilik>", "confidence": <0..1>}

Aturan:
- phone_number: nomor telepon dengan entitas pemiliknya di subject jika jelas.
- operating_hours: jam operasional (mis. "08:00-15:00" atau "Senin-Jumat 08:00-15:00").
- address: alamat kantor atau fasilitas.
- office_role_holder: subject = peran (kepala desa, ketua RT, dll), value = nama orangnya.
- service_requirement_item: satu item syarat layanan (mis. "fotokopi KK").
- Kembalikan [] jika tidak ada fakta yang jelas.

TEKS:
{content}`;

export async function extractEntitiesLLM(
  content: string,
  context?: { village_id?: string },
): Promise<ExtractedEntity[]> {
  if (!content.trim()) return [];
  if (!(await isAIGatewayEnabledAsync('llm', context?.village_id ?? null))) {
    return [];
  }

  const prompt = LLM_EXTRACT_PROMPT.replace('{content}', content.substring(0, 2500));

  try {
    const result = await callAIGatewayPrompt({
      lane: 'llm',
      modelPriority: [],
      messages: buildPromptMessages(prompt),
      temperature: 0.0,
      maxTokens: 600,
      timeoutMs: 15_000,
      jsonMode: true,
      layerType: 'micro_nlu',
      callType: 'consistency_entity_extract',
      context,
    });

    const text = result?.text?.trim();
    if (!text) return [];

    // The gateway returns JSON with either a raw array or an object wrapping one.
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      return [];
    }
    const array = Array.isArray(parsed)
      ? parsed
      : Array.isArray((parsed as { items?: unknown }).items)
        ? (parsed as { items: unknown[] }).items
        : Array.isArray((parsed as { entities?: unknown }).entities)
          ? (parsed as { entities: unknown[] }).entities
          : [];

    const validKinds: ReadonlySet<ExtractedEntityKind> = new Set([
      'phone_number',
      'operating_hours',
      'address',
      'office_role_holder',
      'service_requirement_item',
    ]);

    const entities: ExtractedEntity[] = [];
    for (const raw of array) {
      if (!raw || typeof raw !== 'object') continue;
      const item = raw as Record<string, unknown>;
      const kind = item.kind as ExtractedEntityKind;
      const value = typeof item.value === 'string' ? item.value.trim() : '';
      if (!value || !validKinds.has(kind)) continue;
      const confidence = typeof item.confidence === 'number'
        ? Math.max(0, Math.min(1, item.confidence))
        : 0.6;
      entities.push({
        kind,
        value,
        subject: typeof item.subject === 'string' && item.subject.trim() ? item.subject.trim() : undefined,
        confidence,
        source: 'llm',
      });
    }
    return entities;
  } catch (error: any) {
    logger.warn('consistency entity extract LLM failed', { error: error.message });
    return [];
  }
}

/**
 * Main entry. Runs regex first, then escalates to LLM when the content
 * clearly contains structured facts but regex didn't catch them (or when
 * regex-only would miss the subject).
 */
export async function extractEntities(
  content: string,
  opts: { allowLlm?: boolean; villageId?: string } = {},
): Promise<ExtractedEntity[]> {
  if (!content.trim()) return [];

  const regexEntities = extractRegex(content);

  // Heuristics: when to call the LLM.
  // - Content contains a phone but regex didn't attach a subject.
  // - Content mentions role keywords but no role holder was extracted.
  // - Regex found nothing but content looks non-trivial (>200 chars + has
  //   a number or "jalan"/"kepala" signal).
  const needsLlm = (() => {
    if (opts.allowLlm === false) return false;
    const phonesWithoutSubject = regexEntities.filter(
      (e) => e.kind === 'phone_number' && !e.subject,
    );
    if (phonesWithoutSubject.length > 0) return true;

    const mentionsRole = /\b(kepala\s+desa|kades|lurah|sekdes|sekretaris\s+desa|rt|rw|camat)\b/i.test(content);
    const hasRoleHolder = regexEntities.some((e) => e.kind === 'office_role_holder');
    if (mentionsRole && !hasRoleHolder) return true;

    if (regexEntities.length === 0 && content.length > 200) {
      return /\b(jalan|jl\.|kepala|jam|buka|telepon|telp|kontak|syarat|biaya)\b/i.test(content);
    }
    return false;
  })();

  if (!needsLlm) return regexEntities;

  const llmEntities = await extractEntitiesLLM(content, { village_id: opts.villageId });
  return mergeEntities(regexEntities, llmEntities);
}

function mergeEntities(regex: ExtractedEntity[], llm: ExtractedEntity[]): ExtractedEntity[] {
  const byKey = new Map<string, ExtractedEntity>();
  const keyOf = (e: ExtractedEntity) =>
    `${e.kind}::${e.value.toLowerCase()}::${(e.subject || '').toLowerCase()}`;

  for (const e of regex) byKey.set(keyOf(e), e);
  for (const e of llm) {
    const key = keyOf(e);
    const existing = byKey.get(key);
    // Prefer regex when it exists; but if regex lacks a subject and LLM has one, enrich.
    if (existing) {
      if (!existing.subject && e.subject) existing.subject = e.subject;
      existing.confidence = Math.max(existing.confidence, e.confidence);
    } else {
      byKey.set(key, e);
    }
  }
  return Array.from(byKey.values());
}
