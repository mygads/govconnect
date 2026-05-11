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
    | 'service_duration_mismatch'
    | 'service_mode_mismatch'
    | 'service_availability_mismatch'
    | 'service_requirement_mismatch';
  offending: string;
  dbValue?: string;
}

const PHONE_REGEX = /\b(?:\+?62|0)\d{2,3}[-.\s]?\d{3,4}[-.\s]?\d{3,4}\b/g;
const SHORT_PHONE_REGEX = /\b\d{3,4}\b/g;
const SHORT_PHONE_CONTEXT_REGEX = /\b(hubungi|telepon|telpon|telp|hotline|call center|kontak|darurat|polisi|ambulans|ambulan|damkar|pemadam)\b/i;
const OFFICE_CONTACT_CONTEXT_REGEX = /\b(nomor kantor|telepon kantor|kontak kantor|kantor desa|kantor kelurahan|balai desa|sekretariat desa|jam buka kantor|alamat kantor)\b/i;
const ADDRESS_SIGNAL_REGEX = /\b(alamat|lokasi|berada di|terletak di|jl\.?|jalan|rt\s*\d|rw\s*\d|dusun|kecamatan|kabupaten)\b/i;
const COST_SIGNAL_REGEX = /\b(gratis|tanpa biaya|rp\.?\s*\d|rupiah|biaya(?:nya)?|tarif(?:nya)?|harga(?:nya)?)\b/i;
const DURATION_SIGNAL_REGEX = /\b(estimasi|proses(?:nya)?|hari kerja|\d+\s*(hari|minggu|bulan|jam))\b/i;
const REQUIREMENT_SIGNAL_REGEX = /\b(syarat|persyaratan|berkas|dokumen)\b/i;
const NO_REQUIREMENT_REGEX = /\b(tidak ada|tanpa)\s+(syarat|persyaratan|berkas|dokumen)\b|\bcukup datang saja\b/i;
const REQUIREMENT_DOC_SIGNAL_REGEX = /\b(ktp|kk|akta|akte|pas foto|foto|surat pengantar|formulir|npwp|bpjs|sertifikat|rekening|buku nikah)\b/i;
const SERVICE_ONLINE_POSITIVE_REGEX = /\b(bisa online|diajukan online|diproses online|via online|lewat formulir|link formulir|isi formulir|ajukan lewat form|via form)\b/i;
const SERVICE_ONLINE_NEGATIVE_REGEX = /\b(tidak bisa online|belum bisa online|hanya offline|offline saja|harus ke kantor|harus datang ke kantor|diproses langsung di kantor|tidak ada link formulir)\b/i;
const SERVICE_AVAILABLE_POSITIVE_REGEX = /\b(tersedia|masih tersedia|aktif|bisa diajukan|bisa diurus|bisa diproses|bisa dilayani)\b/i;
const SERVICE_AVAILABLE_NEGATIVE_REGEX = /\b(belum tersedia|tidak tersedia|sedang tidak tersedia|nonaktif|tidak aktif|belum bisa diajukan|tidak bisa diajukan|tidak bisa diproses)\b/i;
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

function extractPhones(text: string, options?: { allowShortCodes?: boolean }): string[] {
  const matches = [...(text.match(PHONE_REGEX) || [])];

  if (options?.allowShortCodes) {
    for (const match of text.matchAll(SHORT_PHONE_REGEX)) {
      const raw = match[0];
      const start = match.index ?? 0;
      const contextStart = Math.max(0, start - 24);
      const contextEnd = Math.min(text.length, start + raw.length + 24);
      const contextWindow = text.slice(contextStart, contextEnd);
      if (!SHORT_PHONE_CONTEXT_REGEX.test(contextWindow)) continue;
      matches.push(raw);
    }
  }

  const seen = new Set<string>();
  const out: string[] = [];
  for (const m of matches) {
    const normalized = normalizePhone(m);
    const minimumLength = options?.allowShortCodes ? 3 : 7;
    if (normalized.length < minimumLength) continue;
    if (seen.has(normalized)) continue;
    seen.add(normalized);
    out.push(m);
  }
  return out;
}

function isOfficeContact(contact: Awaited<ReturnType<typeof getImportantContacts>>[number]): boolean {
  const haystack = `${contact.name || ''} ${contact.description || ''} ${contact.category?.name || ''}`.toLowerCase();
  return /\b(kantor|sekretariat|balai|admin|petugas|kepala desa|kades|lurah|sekdes|sekretaris desa)\b/i.test(haystack);
}

async function collectKnownVillagePhones(villageId: string, options?: { officeOnly?: boolean }): Promise<Set<string>> {
  const contacts = await getImportantContacts(villageId).catch(() => []);
  const known = new Set<string>();
  for (const contact of contacts) {
    if (!contact.phone) continue;
    if (options?.officeOnly && !isOfficeContact(contact)) continue;
    known.add(normalizePhone(contact.phone));
  }
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

function responseClaimsOnlineAvailability(responseText: string): boolean {
  return SERVICE_ONLINE_POSITIVE_REGEX.test(responseText);
}

function responseClaimsOfflineOnly(responseText: string): boolean {
  return SERVICE_ONLINE_NEGATIVE_REGEX.test(responseText);
}

function responseClaimsServiceAvailable(responseText: string): boolean {
  return SERVICE_AVAILABLE_POSITIVE_REGEX.test(responseText);
}

function responseClaimsServiceUnavailable(responseText: string): boolean {
  return SERVICE_AVAILABLE_NEGATIVE_REGEX.test(responseText);
}

function responseMentionsRequirementDocs(responseText: string): boolean {
  return REQUIREMENT_DOC_SIGNAL_REGEX.test(responseText);
}

function responseMatchesServiceRequirements(
  responseText: string,
  requirements: Array<{ label?: string | null }>,
): boolean {
  const normalizedResponse = normalizeLooseText(responseText);
  if (!normalizedResponse) return false;

  return requirements.some((requirement) => {
    const normalizedLabel = normalizeLooseText(requirement.label || '');
    return normalizedLabel.length >= 3 && normalizedResponse.includes(normalizedLabel);
  });
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

  const phonesInText = extractPhones(responseText, {
    allowShortCodes: result.intent === 'EMERGENCY_CONTACTS' || toolsUsed.includes('get_emergency_contacts'),
  });
  if (phonesInText.length > 0) {
    const usedDirectoryContactTool = toolsUsed.some((t) =>
      t === 'get_important_contact'
      || t === 'get_emergency_contacts',
    );
    const usedVillageProfileTool = toolsUsed.includes('get_village_profile');
    const officeContactContext = OFFICE_CONTACT_CONTEXT_REGEX.test(`${userMessage || ''} ${responseText}`);
    const usedContactTool = usedDirectoryContactTool || usedVillageProfileTool;

    if (usedContactTool) {
      const known = await collectKnownVillagePhones(villageId, {
        officeOnly: usedVillageProfileTool && officeContactContext && !usedDirectoryContactTool,
      });
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
  if (usedServiceTool) {
    const services = await getServiceCatalog(villageId).catch(() => []);
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

    if (matchedService?.mode) {
      const mode = String(matchedService.mode).toLowerCase();
      const claimsOnline = responseClaimsOnlineAvailability(responseText);
      const claimsOfflineOnly = responseClaimsOfflineOnly(responseText);

      if (mode === 'offline' && claimsOnline) {
        mismatches.push({
          kind: 'service_mode_mismatch',
          offending: responseText,
          dbValue: matchedService.mode,
        });
      }

      if ((mode === 'online' || mode === 'both') && claimsOfflineOnly) {
        mismatches.push({
          kind: 'service_mode_mismatch',
          offending: responseText,
          dbValue: matchedService.mode,
        });
      }
    }

    if (matchedService) {
      const claimsAvailable = responseClaimsServiceAvailable(responseText);
      const claimsUnavailable = responseClaimsServiceUnavailable(responseText);

      if (!matchedService.is_active && claimsAvailable) {
        mismatches.push({
          kind: 'service_availability_mismatch',
          offending: responseText,
          dbValue: 'inactive',
        });
      }

      if (matchedService.is_active && claimsUnavailable) {
        mismatches.push({
          kind: 'service_availability_mismatch',
          offending: responseText,
          dbValue: 'active',
        });
      }

      if (REQUIREMENT_SIGNAL_REGEX.test(responseText)) {
        const requirements = Array.isArray(matchedService.requirements) ? matchedService.requirements : [];
        const mentionsDocs = responseMentionsRequirementDocs(responseText);

        if (requirements.length === 0) {
          if (mentionsDocs) {
            mismatches.push({
              kind: 'service_requirement_mismatch',
              offending: responseText,
              dbValue: 'no documented requirements',
            });
          }
        } else if (NO_REQUIREMENT_REGEX.test(responseText)) {
          mismatches.push({
            kind: 'service_requirement_mismatch',
            offending: responseText,
            dbValue: requirements.map((requirement) => requirement.label).filter(Boolean).join(', '),
          });
        } else if (mentionsDocs && !responseMatchesServiceRequirements(responseText, requirements)) {
          mismatches.push({
            kind: 'service_requirement_mismatch',
            offending: responseText,
            dbValue: requirements.map((requirement) => requirement.label).filter(Boolean).join(', '),
          });
        }
      }
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
  const hasServiceMode = mismatches.some((m) => m.kind === 'service_mode_mismatch');
  const hasServiceAvailability = mismatches.some((m) => m.kind === 'service_availability_mismatch');
  const hasServiceRequirement = mismatches.some((m) => m.kind === 'service_requirement_mismatch');

  if (hasPhone && !hasHours && !hasAddress && !hasServiceCost && !hasServiceDuration && !hasServiceMode && !hasServiceAvailability && !hasServiceRequirement) {
    return 'Maaf Pak/Bu, nomor yang saya sebutkan belum cocok dengan daftar kontak resmi desa. Sebutkan nama atau jabatan yang dicari ya, nanti saya bantu cek ulang dari direktori desa.';
  }
  if ((hasHours || hasAddress) && !hasPhone && !hasServiceCost && !hasServiceDuration && !hasServiceMode && !hasServiceAvailability && !hasServiceRequirement) {
    return 'Maaf Pak/Bu, ada ketidaksesuaian dengan profil resmi desa. Biar tidak keliru, sebaiknya saya cek lagi dari data resmi kantor desa ya.';
  }
  if ((hasServiceCost || hasServiceDuration || hasServiceMode || hasServiceAvailability || hasServiceRequirement) && !hasPhone && !hasHours && !hasAddress) {
    return 'Maaf Pak/Bu, detail layanan tadi belum cocok dengan katalog resmi desa. Biar tidak keliru, saya perlu cek lagi dari data layanan resmi ya.';
  }
  return 'Maaf Pak/Bu, ada beberapa data yang belum cocok dengan catatan resmi desa. Biar tidak keliru, sebaiknya saya cek ulang dulu dari sumber resmi ya.';
}
