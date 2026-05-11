/**
 * Consistency entity extractor.
 *
 * Hybrid: regex-first, LLM fallback when regex returns ambiguous results.
 * Pulls structured facts (phone numbers, operating hours, addresses,
 * role holders, service facts, and service requirements) out of a document
 * chunk so the doc-vs-db pipeline can cross-check them against DB ground truth.
 */

import logger from '../utils/logger';
import { buildPromptMessages, callAIGatewayPrompt, isAIGatewayEnabledAsync } from './ai-gateway.service';
import {
  REQUIREMENT_DOC_SIGNAL_REGEX,
  SERVICE_ONLINE_NEGATIVE_REGEX,
  SERVICE_ONLINE_POSITIVE_REGEX,
} from './service-grounding.utils';

export type ExtractedEntityKind =
  | 'phone_number'
  | 'operating_hours'
  | 'address'
  | 'office_role_holder'
  | 'service_cost'
  | 'service_duration'
  | 'service_mode'
  | 'service_requirement_item';

export interface ExtractedEntity {
  kind: ExtractedEntityKind;
  value: string;
  subject?: string;
  confidence: number;
  source: 'regex' | 'llm';
}

const PHONE_REGEX = /\b(?:\+?62|0)\d{2,3}[-.\s]?\d{3,4}[-.\s]?\d{3,4}\b/g;
const TIME_REGEX = /\b\d{1,2}[:.]\d{2}(?:\s*(?:s[.]?d[.]?|sampai|sd|-|–)\s*\d{1,2}[:.]\d{2})?\b/gi;
const ADDRESS_REGEX = /\b(?:jl|jalan)\.?\s+[A-Za-z0-9.\-\s]{3,}(?:no\.?\s*\d+)?(?:\s*,\s*rt\s*\d+(?:\/\d+)?)?\b/gi;
const ROLE_REGEX = /\b(kepala\s+desa|kades|lurah|sekretaris\s+desa|sekdes|ketua\s+rt(?:\s*\d+)?|ketua\s+rw(?:\s*\d+)?|camat)\b[^.\n]*?[:\-]\s*([A-Z][a-zA-Z\s.]{3,50})/gi;
const COST_VALUE_REGEX = /\b(?:gratis|tanpa biaya|(?:rp\.?|rupiah)\s*[\d.]+)\b/gi;
const DURATION_VALUE_REGEX = /\b\d+(?:\s*-\s*\d+)?\s*(?:hari|minggu|bulan|jam)(?:\s+kerja)?\b/gi;
const REQUIREMENT_SECTION_REGEX = /\b(syarat|persyaratan|berkas|dokumen(?:\s+yang\s+diperlukan)?)\b/i;
const REQUIREMENT_SPLIT_REGEX = /\s*(?:,|;|\/|\bdan\b)\s*/i;
const BULLET_PREFIX_REGEX = /^(?:[-*•]|\d+[.)])\s*(.+)$/;
const REQUIREMENT_GENERIC_SIGNAL_REGEX = /\b(surat|fotokopi|formulir|berkas|dokumen)\b/i;
const BOTH_MODE_REGEX = /\b(?:online\s+dan\s+offline|offline\s+dan\s+online|baik\s+online\s+maupun\s+offline|secara\s+online\s+maupun\s+offline)\b/i;

function normalizeWhitespace(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

function pushEntity(out: ExtractedEntity[], seen: Set<string>, entity: ExtractedEntity) {
  const key = `${entity.kind}:${entity.value.toLowerCase()}:${(entity.subject || '').toLowerCase()}`;
  if (seen.has(key)) return;
  seen.add(key);
  out.push(entity);
}

function normalizeRequirementValue(value: string): string {
  return normalizeWhitespace(value)
    .replace(/^[\-–—:•\d.)\s]+/, '')
    .replace(/[.]+$/, '')
    .trim();
}

function shouldKeepRequirementCandidate(value: string): boolean {
  if (!value) return false;
  if (value.length < 3 || value.length > 120) return false;
  return REQUIREMENT_DOC_SIGNAL_REGEX.test(value) || REQUIREMENT_GENERIC_SIGNAL_REGEX.test(value);
}

function splitRequirementInlineList(value: string): string[] {
  return value
    .split(REQUIREMENT_SPLIT_REGEX)
    .map((item) => normalizeRequirementValue(item))
    .filter(shouldKeepRequirementCandidate);
}

function extractRequirementItems(content: string): string[] {
  const items: string[] = [];
  let inRequirementSection = false;
  let sectionLines = 0;

  for (const rawLine of content.split(/\r?\n/)) {
    const line = normalizeWhitespace(rawLine);
    if (!line) {
      inRequirementSection = false;
      sectionLines = 0;
      continue;
    }

    const sectionMatch = line.match(REQUIREMENT_SECTION_REGEX);
    if (sectionMatch) {
      inRequirementSection = true;
      sectionLines = 0;
      const afterHeading = normalizeRequirementValue(
        line.slice((sectionMatch.index ?? 0) + sectionMatch[0].length).replace(/^[\s:.-]+/, ''),
      );
      for (const item of splitRequirementInlineList(afterHeading)) {
        items.push(item);
      }
      continue;
    }

    if (!inRequirementSection) continue;

    const bulletMatch = line.match(BULLET_PREFIX_REGEX);
    if (bulletMatch) {
      const item = normalizeRequirementValue(bulletMatch[1]);
      if (shouldKeepRequirementCandidate(item)) {
        items.push(item);
      }
      sectionLines++;
      continue;
    }

    if (sectionLines === 0) {
      for (const item of splitRequirementInlineList(line)) {
        items.push(item);
      }
      continue;
    }

    if (shouldKeepRequirementCandidate(line) && sectionLines < 6) {
      items.push(line);
      sectionLines++;
      continue;
    }

    inRequirementSection = false;
    sectionLines = 0;
  }

  return items;
}

function extractRegex(content: string): ExtractedEntity[] {
  const out: ExtractedEntity[] = [];
  const seen = new Set<string>();

  for (const match of content.matchAll(PHONE_REGEX)) {
    const value = match[0];
    const subjectWindow = content.substring(Math.max(0, match.index! - 60), match.index!).trim();
    const subjectMatch = subjectWindow.match(/([A-Z][a-zA-Z\s]{2,40})\s*[:\-]?\s*$/);
    pushEntity(out, seen, {
      kind: 'phone_number',
      value,
      subject: subjectMatch ? normalizeWhitespace(subjectMatch[1]) : undefined,
      confidence: 0.9,
      source: 'regex',
    });
  }

  for (const match of content.matchAll(TIME_REGEX)) {
    const value = normalizeWhitespace(match[0]);
    pushEntity(out, seen, {
      kind: 'operating_hours',
      value,
      confidence: value.includes('-') || /s[.]?d[.]?/i.test(value) ? 0.85 : 0.6,
      source: 'regex',
    });
  }

  for (const match of content.matchAll(ADDRESS_REGEX)) {
    const value = normalizeWhitespace(match[0]);
    pushEntity(out, seen, {
      kind: 'address',
      value,
      confidence: 0.7,
      source: 'regex',
    });
  }

  for (const match of content.matchAll(ROLE_REGEX)) {
    const role = normalizeWhitespace(match[1]);
    const holder = normalizeWhitespace(match[2]);
    pushEntity(out, seen, {
      kind: 'office_role_holder',
      value: holder,
      subject: role,
      confidence: 0.75,
      source: 'regex',
    });
  }

  for (const match of content.matchAll(COST_VALUE_REGEX)) {
    const value = normalizeWhitespace(match[0]);
    pushEntity(out, seen, {
      kind: 'service_cost',
      value,
      confidence: /gratis|tanpa biaya/i.test(value) ? 0.9 : 0.85,
      source: 'regex',
    });
  }

  for (const match of content.matchAll(DURATION_VALUE_REGEX)) {
    const value = normalizeWhitespace(match[0]);
    pushEntity(out, seen, {
      kind: 'service_duration',
      value,
      confidence: 0.85,
      source: 'regex',
    });
  }

  for (const sentence of content.split(/[.\n]+/)) {
    const value = normalizeWhitespace(sentence);
    if (!value) continue;

    if (BOTH_MODE_REGEX.test(value)) {
      pushEntity(out, seen, {
        kind: 'service_mode',
        value: 'both',
        confidence: 0.9,
        source: 'regex',
      });
      continue;
    }

    if (SERVICE_ONLINE_NEGATIVE_REGEX.test(value)) {
      pushEntity(out, seen, {
        kind: 'service_mode',
        value: 'offline',
        confidence: 0.85,
        source: 'regex',
      });
      continue;
    }

    if (SERVICE_ONLINE_POSITIVE_REGEX.test(value)) {
      pushEntity(out, seen, {
        kind: 'service_mode',
        value: 'online',
        confidence: 0.8,
        source: 'regex',
      });
    }
  }

  for (const requirement of extractRequirementItems(content)) {
    pushEntity(out, seen, {
      kind: 'service_requirement_item',
      value: requirement,
      confidence: 0.8,
      source: 'regex',
    });
  }

  return out;
}

const LLM_EXTRACT_PROMPT = `Kamu adalah entity extractor untuk dokumen layanan desa.
Ekstrak fakta terstruktur berikut dari TEKS di bawah. Hanya ekstrak yang JELAS tertulis. JANGAN tebak.

Kembalikan JSON array dengan item berbentuk:
{"kind": "<phone_number|operating_hours|address|office_role_holder|service_cost|service_duration|service_mode|service_requirement_item>", "value": "<nilai>", "subject": "<opsional, mis. nama layanan atau nama peran>", "confidence": <0..1>}

Aturan:
- phone_number: nomor telepon dengan entitas pemiliknya di subject jika jelas.
- operating_hours: jam operasional (mis. "08:00-15:00" atau "Senin-Jumat 08:00-15:00").
- address: alamat kantor atau fasilitas.
- office_role_holder: subject = peran (kepala desa, ketua RT, dll), value = nama orangnya.
- service_cost: biaya layanan yang tertulis (mis. "Gratis" atau "Rp 10.000"). subject = nama layanan jika jelas.
- service_duration: estimasi waktu proses layanan (mis. "2 hari kerja"). subject = nama layanan jika jelas.
- service_mode: value harus salah satu dari "online", "offline", atau "both". subject = nama layanan jika jelas.
- service_requirement_item: satu item syarat layanan (mis. "fotokopi KK"). subject = nama layanan jika jelas.
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
      'service_cost',
      'service_duration',
      'service_mode',
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

export async function extractEntities(
  content: string,
  opts: { allowLlm?: boolean; villageId?: string } = {},
): Promise<ExtractedEntity[]> {
  if (!content.trim()) return [];

  const regexEntities = extractRegex(content);

  const needsLlm = (() => {
    if (opts.allowLlm === false) return false;
    const phonesWithoutSubject = regexEntities.filter(
      (entity) => entity.kind === 'phone_number' && !entity.subject,
    );
    if (phonesWithoutSubject.length > 0) return true;

    const mentionsRole = /\b(kepala\s+desa|kades|lurah|sekdes|sekretaris\s+desa|rt|rw|camat)\b/i.test(content);
    const hasRoleHolder = regexEntities.some((entity) => entity.kind === 'office_role_holder');
    if (mentionsRole && !hasRoleHolder) return true;

    if (regexEntities.length === 0 && content.length > 200) {
      return /\b(jalan|jl\.|kepala|jam|buka|telepon|telp|kontak|syarat|biaya|estimasi|online|offline|layanan)\b/i.test(content);
    }

    return false;
  })();

  if (!needsLlm) return regexEntities;

  const llmEntities = await extractEntitiesLLM(content, { village_id: opts.villageId });
  return mergeEntities(regexEntities, llmEntities);
}

function mergeEntities(regex: ExtractedEntity[], llm: ExtractedEntity[]): ExtractedEntity[] {
  const byKey = new Map<string, ExtractedEntity>();
  const keyOf = (entity: ExtractedEntity) =>
    `${entity.kind}::${entity.value.toLowerCase()}::${(entity.subject || '').toLowerCase()}`;

  for (const entity of regex) byKey.set(keyOf(entity), entity);
  for (const entity of llm) {
    const key = keyOf(entity);
    const existing = byKey.get(key);
    if (existing) {
      if (!existing.subject && entity.subject) existing.subject = entity.subject;
      existing.confidence = Math.max(existing.confidence, entity.confidence);
    } else {
      byKey.set(key, entity);
    }
  }
  return Array.from(byKey.values());
}
