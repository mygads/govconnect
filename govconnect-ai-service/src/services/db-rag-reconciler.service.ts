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
import { recordRuntimeGroundingMismatches } from './runtime-grounding-mismatch.service';
import {
  COST_SIGNAL_REGEX,
  DURATION_SIGNAL_REGEX,
  NO_REQUIREMENT_REGEX,
  REQUIREMENT_DOC_SIGNAL_REGEX,
  REQUIREMENT_SIGNAL_REGEX,
  SERVICE_AVAILABLE_NEGATIVE_REGEX,
  SERVICE_AVAILABLE_POSITIVE_REGEX,
  SERVICE_ONLINE_NEGATIVE_REGEX,
  SERVICE_ONLINE_POSITIVE_REGEX,
  findUniqueServiceMention,
  normalizeLooseText,
  responseClaimsOfflineOnly,
  responseClaimsOnlineAvailability,
  responseClaimsServiceAvailable,
  responseClaimsServiceUnavailable,
  responseMatchesDbValue,
  responseMentionsRequirementDocs,
  responseMatchesServiceCost,
  responseMatchesServiceDuration,
  responseMatchesServiceRequirements,
  significantTokens,
} from './service-grounding.utils';
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
  entityType?: 'important_contact' | 'village_profile' | 'service';
  entityId?: string;
}

const PHONE_REGEX = /\b(?:\+?62|0)\d{2,3}[-.\s]?\d{3,4}[-.\s]?\d{3,4}\b/g;
const SHORT_PHONE_REGEX = /\b\d{3,4}\b/g;
const SHORT_PHONE_CONTEXT_REGEX = /\b(hubungi|telepon|telpon|telp|hotline|call center|kontak|darurat|polisi|ambulans|ambulan|damkar|pemadam)\b/i;
const OFFICE_CONTACT_CONTEXT_REGEX = /\b(nomor kantor|telepon kantor|kontak kantor|kantor desa|kantor kelurahan|balai desa|sekretariat desa|jam buka kantor|alamat kantor)\b/i;
const ADDRESS_SIGNAL_REGEX = /\b(alamat|lokasi|berada di|terletak di|jl\.?|jalan|rt\s*\d|rw\s*\d|dusun|kecamatan|kabupaten)\b/i;
const ADDRESS_STOPWORDS = new Set(['alamat', 'lokasi', 'berada', 'terletak', 'di', 'desa', 'kantor']);

function normalizePhone(raw: string): string {
  const digits = raw.replace(/[^\d]/g, '');
  if (digits.startsWith('62')) return '0' + digits.slice(2);
  return digits;
}

function addressTokens(raw: string): string[] {
  return significantTokens(raw, ADDRESS_STOPWORDS);
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
  const dbTokens = addressTokens(dbAddress);
  if (dbTokens.length === 0) return true;

  const responseTokenSet = new Set(addressTokens(responseText));
  const overlap = dbTokens.filter((token) => responseTokenSet.has(token)).length;

  if (dbTokens.length <= 2) {
    return overlap >= 1;
  }

  return overlap >= Math.min(2, dbTokens.length);
}

async function persistRuntimeMismatchRecords(params: {
  villageId: string;
  traceId?: string;
  userMessage?: string;
  responseText: string;
  toolsUsed: string[];
  mismatches: Mismatch[];
}) {
  const { villageId, traceId, userMessage, responseText, toolsUsed, mismatches } = params;
  if (mismatches.length === 0) return;

  await recordRuntimeGroundingMismatches(
    mismatches.map((mismatch) => ({
      villageId,
      traceId,
      userQuery: userMessage || null,
      responseExcerpt: responseText,
      toolsUsed,
      mismatchKind: mismatch.kind,
      offendingValue: mismatch.offending,
      authoritativeValue: mismatch.dbValue ?? null,
      entityType: mismatch.entityType ?? null,
      entityId: mismatch.entityId ?? null,
    })),
  );
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
      const officeOnly = usedVillageProfileTool && officeContactContext && !usedDirectoryContactTool;
      const known = await collectKnownVillagePhones(villageId, { officeOnly });
      const authoritativePhones = Array.from(known).slice(0, 5).join(', ') || undefined;
      for (const raw of phonesInText) {
        const normalized = normalizePhone(raw);
        if (!known.has(normalized)) {
          mismatches.push({
            kind: 'phone_not_in_db',
            offending: raw,
            dbValue: authoritativePhones,
            entityType: officeOnly ? 'village_profile' : 'important_contact',
            entityId: officeOnly ? villageId : undefined,
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
            entityType: 'village_profile',
            entityId: villageId,
          });
        }
      }
    }

    if (mentionsAddress && profile?.address && !responseMatchesAddress(responseText, profile.address)) {
      mismatches.push({
        kind: 'office_address_mismatch',
        offending: responseText,
        dbValue: profile.address,
        entityType: 'village_profile',
        entityId: villageId,
      });
    }
  }

  const usedServiceTool = toolsUsed.includes('get_service_info');
  // DB-first for service requirements also applies when the answer was sourced
  // from the KB (search_knowledge/search_documents) WITHOUT get_service_info:
  // a KB document can list different requirements than the DB service
  // requirements, and the DB must win. Cost/duration/mode/availability stay
  // gated on the service tool to avoid false positives on narrative KB text.
  const kbAnswersRequirements = !usedServiceTool
    && REQUIREMENT_SIGNAL_REGEX.test(responseText)
    && responseMentionsRequirementDocs(responseText);
  if (usedServiceTool || kbAnswersRequirements) {
    const services = await getServiceCatalog(villageId).catch(() => []);
    const matchedService = findUniqueServiceMention(services, [userMessage || '', responseText]);

    if (
      usedServiceTool
      && matchedService?.estimated_cost
      && COST_SIGNAL_REGEX.test(responseText)
      && !responseMatchesServiceCost(responseText, matchedService.estimated_cost)
    ) {
      mismatches.push({
        kind: 'service_cost_mismatch',
        offending: responseText,
        dbValue: matchedService.estimated_cost,
        entityType: 'service',
        entityId: matchedService.id,
      });
    }

    if (
      usedServiceTool
      && matchedService?.estimated_processing_time
      && DURATION_SIGNAL_REGEX.test(responseText)
      && !responseMatchesServiceDuration(responseText, matchedService.estimated_processing_time)
    ) {
      mismatches.push({
        kind: 'service_duration_mismatch',
        offending: responseText,
        dbValue: matchedService.estimated_processing_time,
        entityType: 'service',
        entityId: matchedService.id,
      });
    }

    if (usedServiceTool && matchedService?.mode) {
      const mode = String(matchedService.mode).toLowerCase();
      const claimsOnline = responseClaimsOnlineAvailability(responseText);
      const claimsOfflineOnly = responseClaimsOfflineOnly(responseText);

      if (mode === 'offline' && claimsOnline) {
        mismatches.push({
          kind: 'service_mode_mismatch',
          offending: responseText,
          dbValue: matchedService.mode,
          entityType: 'service',
          entityId: matchedService.id,
        });
      }

      if ((mode === 'online' || mode === 'both') && claimsOfflineOnly) {
        mismatches.push({
          kind: 'service_mode_mismatch',
          offending: responseText,
          dbValue: matchedService.mode,
          entityType: 'service',
          entityId: matchedService.id,
        });
      }
    }

    if (usedServiceTool && matchedService) {
      const claimsAvailable = responseClaimsServiceAvailable(responseText);
      const claimsUnavailable = responseClaimsServiceUnavailable(responseText);

      if (!matchedService.is_active && claimsAvailable) {
        mismatches.push({
          kind: 'service_availability_mismatch',
          offending: responseText,
          dbValue: 'inactive',
          entityType: 'service',
          entityId: matchedService.id,
        });
      }

      if (matchedService.is_active && claimsUnavailable) {
        mismatches.push({
          kind: 'service_availability_mismatch',
          offending: responseText,
          dbValue: 'active',
          entityType: 'service',
          entityId: matchedService.id,
        });
      }
    }

    // Requirements check runs on BOTH paths: get_service_info answers AND
    // KB-sourced answers (kbAnswersRequirements). DB service requirements
    // always win over any requirement list coming from KB documents.
    if (matchedService && (usedServiceTool || kbAnswersRequirements) && REQUIREMENT_SIGNAL_REGEX.test(responseText)) {
        const requirements = Array.isArray(matchedService.requirements) ? matchedService.requirements : [];
        const mentionsDocs = responseMentionsRequirementDocs(responseText);

        if (requirements.length === 0) {
          if (mentionsDocs) {
            mismatches.push({
              kind: 'service_requirement_mismatch',
              offending: responseText,
              dbValue: 'no documented requirements',
              entityType: 'service',
              entityId: matchedService.id,
            });
          }
        } else if (NO_REQUIREMENT_REGEX.test(responseText)) {
          mismatches.push({
            kind: 'service_requirement_mismatch',
            offending: responseText,
            dbValue: requirements.map((requirement) => requirement.label).filter(Boolean).join(', '),
            entityType: 'service',
            entityId: matchedService.id,
          });
        } else if (mentionsDocs && !responseMatchesServiceRequirements(responseText, requirements)) {
          mismatches.push({
            kind: 'service_requirement_mismatch',
            offending: responseText,
            dbValue: requirements.map((requirement) => requirement.label).filter(Boolean).join(', '),
            entityType: 'service',
            entityId: matchedService.id,
          });
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

  await persistRuntimeMismatchRecords({
    villageId,
    traceId: result.metadata?.traceId,
    userMessage,
    responseText,
    toolsUsed,
    mismatches,
  });

  const startTime = Date.now() - (result.metadata?.processingTimeMs || 0);

  // [P1-1 FIX] Jika mismatch HANYA phone_not_in_db dan user TIDAK bertanya tentang kontak,
  // strip nomor yang tidak terverifikasi saja, jangan rewrite seluruh respons.
  const onlyPhoneMismatch = mismatches.length > 0
    && mismatches.every((m) => m.kind === 'phone_not_in_db');
  const hasUserMessage = !!(userMessage && userMessage.trim());
  const userWantsContact = userAskedAboutContact(userMessage);

  let finalResponse: string;
  let guardrailAction = 'rewritten';
  if (onlyPhoneMismatch && hasUserMessage && !userWantsContact) {
    const badPhones = mismatches.map((m) => m.offending).filter(Boolean) as string[];
    finalResponse = stripUnverifiedPhones(responseText, badPhones);
    guardrailAction = 'phone_stripped';
  } else {
    finalResponse = buildHonestFallback(mismatches);
  }

  const replacement: ProcessMessageResult = {
    success: true,
    response: finalResponse,
    intent: result.intent,
    metadata: {
      processingTimeMs: Date.now() - startTime,
      hasKnowledge: false,
      agentMode: 'answer_policy_verifier',
      traceId: result.metadata?.traceId,
      guardrail: {
        stage: 'db_rag_reconciler',
        type: mismatches[0].kind,
        action: guardrailAction,
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

/**
 * [P1-1 FIX] Deteksi apakah user bertanya tentang kontak/nomor telepon.
 * Digunakan untuk membedakan:
 * - User tanya kontak -> nomor tidak ada di DB = guardrail valid, rewrite respons
 * - User tanya hal lain (jam, alamat) -> nomor terselip = strip nomor saja, jangan rewrite
 */
const CONTACT_QUESTION_REGEX = /\b(nomor|nomer|no\.?\s*(hp|telp|telepon|wa|whatsapp)|kontak|hubungi|telepon|telpon|hotline|call\s*center)\b/i;

function userAskedAboutContact(userMessage?: string): boolean {
  if (!userMessage) return false;
  return CONTACT_QUESTION_REGEX.test(userMessage);
}

/**
 * [P1-1 FIX] Strip nomor telepon yang tidak terverifikasi dari teks respons.
 * Digunakan ketika nomor terselip di jawaban non-kontak (mis. info jam operasional).
 */
function stripUnverifiedPhones(text: string, unverifiedPhones: string[]): string {
  let result = text;
  for (const phone of unverifiedPhones) {
    const escaped = phone.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    result = result.replace(new RegExp(escaped, 'g'), '');
  }
  result = result.replace(/\s{2,}/g, ' ').trim();
  // Bersihkan sisa kalimat yang menggantung
  result = result.replace(/\s*[,.;]\s*$/, '');
  return result;
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
