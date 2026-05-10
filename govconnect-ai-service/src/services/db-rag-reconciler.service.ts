/**
 * DB-vs-RAG reconciler.
 *
 * Post-generation safety net. Scans the final agent response for structured
 * facts (phone numbers, operating hours, office address, and core service
 * details) and cross-checks them against authoritative DB values. When the
 * response contains a value that the DB disagrees with, the text is rewritten
 * to avoid surfacing a conflicting answer.
 *
 * The answer-policy verifier enforces "DB tool must be called for this kind
 * of question". This service enforces "if the model stated a DB-authoritative
 * value, that value must actually match the DB".
 */

import logger from '../utils/logger';
import { getServiceCatalog, type ServiceCatalogItem } from './case-client.service';
import { getImportantContacts } from './important-contacts.service';
import { getVillageProfileSummary } from './knowledge.service';
import type { ProcessMessageResult } from './ump-types';

export interface ReconcileInput {
  villageId?: string;
  userMessage?: string;
  result: ProcessMessageResult;
  toolsUsed: string[];
}

export interface ReconcileDecision {
  ok: boolean;
  rewritten: boolean;
  mismatches: Mismatch[];
  replacement?: ProcessMessageResult;
}

export interface Mismatch {
  kind:
    | 'phone_not_in_db'
    | 'operating_hour_mismatch'
    | 'office_address_mismatch'
    | 'service_cost_mismatch'
    | 'service_duration_mismatch';
  offending: string;
  dbValue?: string;
}

const PHONE_REGEX = /\b(?:\+?62|0)\d{2,3}[-.\s]?\d{3,4}[-.\s]?\d{3,4}\b/g;
const ADDRESS_SIGNAL_REGEX = /\b(alamat|lokasi|berada di|terletak di|jl\.?|jalan|rt\s*\d|rw\s*\d|dusun|kecamatan|kabupaten)\b/i;
const COST_SIGNAL_REGEX = /\b(gratis|tanpa biaya|rp\.?\s*\d|rupiah|biaya(?:nya)?|tarif(?:nya)?|harga(?:nya)?)\b/i;
const DURATION_SIGNAL_REGEX = /\b(estimasi|proses(?:nya)?|hari kerja|\d+\s*(hari|minggu|bulan|jam))\b/i;
const ADDRESS_STOPWORDS = new Set(['alamat', 'lokasi', 'berada', 'terletak', 'di', 'desa', 'kantor']);

function normalizePhone(raw: string): string {
  const digits = raw.replace(/[^\d]/g, '');
  if (digits.startsWith('62')) return '0' + digits.slice(2);
  return digits;
}

function normalizeLooseText(raw: string): string {
  return (raw || '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\b(tanpa biaya)\b/g, 'gratis')
    .replace(/\bsekitar\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function significantTokens(raw: string, stopwords: Set<string> = ADDRESS_STOPWORDS): string[] {
  return normalizeLooseText(raw)
    .split(' ')
    .map((token) => token.trim())
    .filter((token) => token.length >= 3 && !stopwords.has(token));
}

function extractPhones(text: string): string[] {
  const matches = text.match(PHONE_REGEX) || [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const m of matches) {
    const normalized = normalizePhone(m);
    if (normalized.length < 7) continue;
    if (seen.has(normalized)) continue;
    seen.add(normalized);
    out.push(m);
  }
  return out;
}

async function collectKnownVillagePhones(villageId: string): Promise<Set<string>> {
  const contacts = await getImportantContacts(villageId).catch(() => []);
  const known = new Set<string>();
  for (const contact of contacts) {
    if (!contact.phone) continue;
    known.add(normalizePhone(contact.phone));
  }
  for (const nat of ['110', '119', '113', '118', '115', '112']) known.add(nat);
  return known;
}

function responseMatchesAddress(responseText: string, dbAddress: string): boolean {
  const dbTokens = significantTokens(dbAddress);
  if (dbTokens.length === 0) return true;

  const responseTokenSet = new Set(significantTokens(responseText));
  const overlap = dbTokens.filter((token) => responseTokenSet.has(token)).length;

  if (dbTokens.length <= 2) {
    return overlap >= 1;
  }

  return overlap >= Math.min(2, dbTokens.length);
}

function findUniqueServiceMention(
  services: ServiceCatalogItem[],
  texts: string[],
): ServiceCatalogItem | null {
  if (services.length === 1) {
    return services[0];
  }

  const haystack = normalizeLooseText(texts.filter(Boolean).join(' '));
  if (!haystack) return null;

  const matches = services.filter((service) => {
    const normalizedName = normalizeLooseText(service.name || '');
    if (!normalizedName || normalizedName.length < 4) return false;
    if (haystack.includes(normalizedName)) return true;

    const nameTokens = significantTokens(service.name || '', new Set());
    const matchedTokens = nameTokens.filter((token) => haystack.includes(token));
    return matchedTokens.length >= Math.min(2, nameTokens.length);
  });

  return matches.length === 1 ? matches[0] : null;
}

function responseMatchesDbValue(responseText: string, dbValue: string): boolean {
  const normalizedResponse = normalizeLooseText(responseText);
  const normalizedDbValue = normalizeLooseText(dbValue);
  if (!normalizedDbValue) return true;
  return normalizedResponse.includes(normalizedDbValue);
}

function normalizeDigits(raw: string): string {
  return (raw || '').replace(/[^\d]/g, '');
}

function responseMatchesServiceCost(responseText: string, dbValue: string): boolean {
  const normalizedDbValue = normalizeLooseText(dbValue);
  if (!normalizedDbValue) return true;

  const mentionsGratis = /\b(gratis|tanpa biaya)\b/i.test(responseText);
  const mentionedAmounts = Array.from(responseText.matchAll(/\b(?:rp\.?|rupiah)\s*([\d.]+)/gi))
    .map((match) => normalizeDigits(match[1] || ''))
    .filter(Boolean);

  if (normalizedDbValue.includes('gratis')) {
    return mentionsGratis && mentionedAmounts.length === 0;
  }

  const dbDigits = normalizeDigits(dbValue);
  if (dbDigits) {
    return mentionedAmounts.includes(dbDigits);
  }

  return responseMatchesDbValue(responseText, dbValue);
}

function responseMatchesServiceDuration(responseText: string, dbValue: string): boolean {
  const normalizedDbValue = normalizeLooseText(dbValue);
  if (!normalizedDbValue) return true;

  const normalizedResponse = normalizeLooseText(responseText);
  if (normalizedResponse.includes(normalizedDbValue)) return true;

  const dbDurationTokens = dbValue.match(/\d+\s*(?:hari|minggu|bulan|jam)(?:\s+kerja)?/gi) || [];
  if (dbDurationTokens.length === 0) return false;

  const responseDurationTokens = responseText.match(/\d+\s*(?:hari|minggu|bulan|jam)(?:\s+kerja)?/gi) || [];
  const normalizedResponseDurations = new Set(responseDurationTokens.map((item) => normalizeLooseText(item)));

  return dbDurationTokens
    .map((item) => normalizeLooseText(item))
    .some((item) => normalizedResponseDurations.has(item));
}

export async function reconcile(input: ReconcileInput): Promise<ReconcileDecision> {
  const { villageId, userMessage, result, toolsUsed } = input;

  if (!villageId) {
    return { ok: true, rewritten: false, mismatches: [] };
  }

  const responseText = `${result.response || ''}\n${result.guidanceText || ''}`.trim();
  if (!responseText) {
    return { ok: true, rewritten: false, mismatches: [] };
  }

  const mismatches: Mismatch[] = [];

  const phonesInText = extractPhones(responseText);
  if (phonesInText.length > 0) {
    const usedContactTool = toolsUsed.some((t) =>
      t === 'get_important_contact'
      || t === 'get_emergency_contacts'
      || t === 'get_village_profile',
    );

    if (usedContactTool) {
      const known = await collectKnownVillagePhones(villageId);
      for (const raw of phonesInText) {
        const normalized = normalizePhone(raw);
        if (!known.has(normalized)) {
          mismatches.push({
            kind: 'phone_not_in_db',
            offending: raw,
          });
        }
      }
    }
  }

  const usedProfileTool = toolsUsed.includes('get_village_profile');
  const mentionsTime = /\b\d{1,2}[:.]\d{2}\b/.test(responseText);
  const mentionsAddress = ADDRESS_SIGNAL_REGEX.test(responseText);
  if (usedProfileTool && (mentionsTime || mentionsAddress)) {
    const profile = await getVillageProfileSummary(villageId).catch(() => null);

    if (mentionsTime) {
      const dbHoursText = profile?.operating_hours
        ? typeof profile.operating_hours === 'string'
          ? profile.operating_hours
          : JSON.stringify(profile.operating_hours)
        : '';
      const dbTimes = dbHoursText.match(/\d{1,2}[:.]\d{2}/g) || [];
      const dbTimeSet = new Set(dbTimes.map((t) => t.replace('.', ':')));
      const responseTimes = responseText.match(/\b\d{1,2}[:.]\d{2}\b/g) || [];
      for (const t of responseTimes) {
        const canonical = t.replace('.', ':');
        if (dbTimeSet.size === 0) continue;
        if (!dbTimeSet.has(canonical)) {
          mismatches.push({
            kind: 'operating_hour_mismatch',
            offending: t,
            dbValue: dbHoursText,
          });
        }
      }
    }

    if (mentionsAddress && profile?.address && !responseMatchesAddress(responseText, profile.address)) {
      mismatches.push({
        kind: 'office_address_mismatch',
        offending: responseText,
        dbValue: profile.address,
      });
    }
  }

  const usedServiceTool = toolsUsed.includes('get_service_info');
  if (usedServiceTool && (COST_SIGNAL_REGEX.test(responseText) || DURATION_SIGNAL_REGEX.test(responseText))) {
    const services = (await getServiceCatalog(villageId).catch(() => []))
      .filter((service) => service.is_active);
    const matchedService = findUniqueServiceMention(services, [userMessage || '', responseText]);

    if (
      matchedService?.estimated_cost
      && COST_SIGNAL_REGEX.test(responseText)
      && !responseMatchesServiceCost(responseText, matchedService.estimated_cost)
    ) {
      mismatches.push({
        kind: 'service_cost_mismatch',
        offending: responseText,
        dbValue: matchedService.estimated_cost,
      });
    }

    if (
      matchedService?.estimated_processing_time
      && DURATION_SIGNAL_REGEX.test(responseText)
      && !responseMatchesServiceDuration(responseText, matchedService.estimated_processing_time)
    ) {
      mismatches.push({
        kind: 'service_duration_mismatch',
        offending: responseText,
        dbValue: matchedService.estimated_processing_time,
      });
    }
  }

  if (mismatches.length === 0) {
    return { ok: true, rewritten: false, mismatches: [] };
  }

  logger.warn('db-rag-reconciler: mismatch detected — rewriting response', {
    traceId: result.metadata?.traceId,
    mismatches,
  });

  const startTime = Date.now() - (result.metadata?.processingTimeMs || 0);
  const replacement: ProcessMessageResult = {
    success: true,
    response: buildHonestFallback(mismatches),
    intent: result.intent,
    metadata: {
      processingTimeMs: Date.now() - startTime,
      hasKnowledge: false,
      agentMode: 'answer_policy_verifier',
      traceId: result.metadata?.traceId,
      guardrail: {
        stage: 'db_rag_reconciler',
        type: mismatches[0].kind,
        action: 'rewritten',
        reason: 'value_not_in_official_db',
        details: {
          mismatches: mismatches.map((m) => ({
            kind: m.kind,
            offending: m.offending,
            dbValue: m.dbValue ?? null,
          })),
        },
      },
    },
  };

  return { ok: false, rewritten: true, mismatches, replacement };
}

function buildHonestFallback(mismatches: Mismatch[]): string {
  const hasPhone = mismatches.some((m) => m.kind === 'phone_not_in_db');
  const hasHours = mismatches.some((m) => m.kind === 'operating_hour_mismatch');
  const hasAddress = mismatches.some((m) => m.kind === 'office_address_mismatch');
  const hasServiceCost = mismatches.some((m) => m.kind === 'service_cost_mismatch');
  const hasServiceDuration = mismatches.some((m) => m.kind === 'service_duration_mismatch');

  if (hasPhone && !hasHours && !hasAddress && !hasServiceCost && !hasServiceDuration) {
    return 'Maaf Pak/Bu, nomor yang saya sebutkan belum cocok dengan daftar kontak resmi desa. Sebutkan nama atau jabatan yang dicari ya, nanti saya bantu cek ulang dari direktori desa.';
  }
  if ((hasHours || hasAddress) && !hasPhone && !hasServiceCost && !hasServiceDuration) {
    return 'Maaf Pak/Bu, ada ketidaksesuaian dengan profil resmi desa. Biar tidak keliru, sebaiknya saya cek lagi dari data resmi kantor desa ya.';
  }
  if ((hasServiceCost || hasServiceDuration) && !hasPhone && !hasHours && !hasAddress) {
    return 'Maaf Pak/Bu, detail biaya atau estimasi layanan tadi belum cocok dengan katalog resmi desa. Biar tidak keliru, saya perlu cek lagi dari data layanan resmi ya.';
  }
  return 'Maaf Pak/Bu, ada beberapa data yang belum cocok dengan catatan resmi desa. Biar tidak keliru, sebaiknya saya cek ulang dulu dari sumber resmi ya.';
}
