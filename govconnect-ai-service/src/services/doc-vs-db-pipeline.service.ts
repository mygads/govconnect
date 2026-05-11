/**
 * Doc-vs-DB pipeline.
 *
 * Extracts structured entities from document chunks and cross-checks them
 * against DB ground truth. When a document asserts a fact that disagrees
 * with DB, we persist an inconsistency record so an admin can review.
 *
 * Paired sources:
 *   phone_number           ↔ important_contacts
 *   operating_hours        ↔ village_profile.operating_hours
 *   address                ↔ village_profile.address
 *   office_role_holder     ↔ important_contacts (description/name match)
 *   service_cost           ↔ service catalog estimated_cost
 *   service_duration       ↔ service catalog estimated_processing_time
 *   service_mode           ↔ service catalog mode
 *   service_requirement_item ↔ service catalog requirements
 */

import prisma from '../lib/prisma';
import logger from '../utils/logger';
import { getImportantContacts } from './important-contacts.service';
import { getVillageProfileSummary } from './knowledge.service';
import { extractEntities, type ExtractedEntity } from './consistency-entity-extractor.service';
import { recordInconsistency, type InconsistencySeverity } from './knowledge-consistency.service';
import { getServiceCatalog, type ServiceCatalogItem } from './case-client.service';
import {
  COST_SIGNAL_REGEX,
  DURATION_SIGNAL_REGEX,
  NO_REQUIREMENT_REGEX,
  REQUIREMENT_SIGNAL_REGEX,
  findUniqueServiceMention,
  responseMatchesServiceCost,
  responseMatchesServiceDuration,
  responseMatchesServiceRequirements,
  responseMentionsRequirementDocs,
  serviceModeClaimConflicts,
} from './service-grounding.utils';

interface DocChunk {
  id: string;
  document_id: string;
  village_id: string | null;
  content: string;
  document_title: string | null;
  section_title: string | null;
}

function normalizePhone(raw: string): string {
  const digits = raw.replace(/[^\d]/g, '');
  if (digits.startsWith('62')) return '0' + digits.slice(2);
  return digits;
}

function normalizeTime(raw: string): string {
  return raw.replace(/\./g, ':').trim();
}

function containsTime(haystack: string, needle: string): boolean {
  const canonicalNeedle = normalizeTime(needle);
  const canonicalHaystack = haystack.replace(/\./g, ':');
  return canonicalHaystack.includes(canonicalNeedle);
}

interface DbContext {
  villageId: string;
  phonesByNumber: Map<string, { name: string; description?: string | null }>;
  contactsByName: Map<string, string>;
  profileOperatingHoursText: string;
  profileAddress: string;
  services: ServiceCatalogItem[];
}

async function loadDbContext(villageId: string): Promise<DbContext> {
  const [contacts, profile, services] = await Promise.all([
    getImportantContacts(villageId).catch(() => []),
    getVillageProfileSummary(villageId).catch(() => null),
    getServiceCatalog(villageId).catch(() => []),
  ]);

  const phonesByNumber = new Map<string, { name: string; description?: string | null }>();
  const contactsByName = new Map<string, string>();

  for (const contact of contacts) {
    if (contact.phone) {
      phonesByNumber.set(normalizePhone(contact.phone), {
        name: contact.name,
        description: contact.description ?? null,
      });
    }
    if (contact.name) {
      contactsByName.set(contact.name.trim().toLowerCase(), contact.phone || '');
    }
  }

  const profileOperatingHoursText = profile?.operating_hours
    ? typeof profile.operating_hours === 'string'
      ? profile.operating_hours
      : JSON.stringify(profile.operating_hours)
    : '';

  const profileAddress = (profile?.address || '').trim();

  return {
    villageId,
    phonesByNumber,
    contactsByName,
    profileOperatingHoursText,
    profileAddress,
    services: Array.isArray(services) ? services : [],
  };
}

function severityForConfidence(confidence: number): InconsistencySeverity {
  if (confidence >= 0.85) return 'high';
  if (confidence >= 0.6) return 'medium';
  return 'low';
}

async function recordDocVsDbMismatch(params: {
  chunk: DocChunk;
  db: DbContext;
  topicHint: string;
  sourceBId?: string;
  sourceBType: string;
  sourceBTitle: string;
  snippetB: string;
  confidence: number;
}): Promise<void> {
  const { chunk, db, topicHint, sourceBId, sourceBType, sourceBTitle, snippetB, confidence } = params;

  await recordInconsistency({
    villageId: db.villageId,
    kind: 'doc_vs_db',
    topicHint,
    sourceAId: chunk.id,
    sourceAType: 'document',
    sourceATitle: chunk.document_title || 'Dokumen',
    sourceBId,
    sourceBType,
    sourceBTitle,
    snippetA: chunk.content,
    snippetB,
    similarityScore: confidence,
    severity: severityForConfidence(confidence),
    detectedBy: 'doc_vs_db_pipeline',
  });
}

function buildServiceSnippet(service: ServiceCatalogItem): string {
  const requirements = Array.isArray(service.requirements)
    ? service.requirements.map((requirement) => requirement.label).filter(Boolean).join(', ')
    : '';

  return [
    service.name ? `Layanan DB: ${service.name}` : '',
    service.mode ? `Mode DB: ${service.mode}` : '',
    service.estimated_cost ? `Biaya DB: ${service.estimated_cost}` : '',
    service.estimated_processing_time ? `Estimasi DB: ${service.estimated_processing_time}` : '',
    requirements ? `Syarat DB: ${requirements}` : 'Syarat DB: tidak ada',
  ].filter(Boolean).join('\n');
}

function findMatchedService(chunk: DocChunk, db: DbContext): ServiceCatalogItem | null {
  return findUniqueServiceMention(db.services, [
    chunk.section_title || '',
    chunk.document_title || '',
    chunk.content,
  ], {
    requireExplicitMention: true,
  });
}

async function checkEntityAgainstDb(
  chunk: DocChunk,
  entity: ExtractedEntity,
  db: DbContext,
): Promise<boolean> {
  switch (entity.kind) {
    case 'phone_number': {
      const normalized = normalizePhone(entity.value);
      if (normalized.length < 7) return false;
      if (db.phonesByNumber.has(normalized)) return false;

      const subject = entity.subject?.trim().toLowerCase();
      let dbValue: string | undefined;
      let title = 'Data kontak desa (DB)';
      if (subject) {
        for (const [dbName, dbPhone] of db.contactsByName) {
          if (dbName.includes(subject) || subject.includes(dbName)) {
            dbValue = dbPhone;
            title = `Kontak DB: ${dbName}`;
            break;
          }
        }
      }

      await recordDocVsDbMismatch({
        chunk,
        db,
        topicHint: 'phone_number',
        sourceBType: 'db_contact',
        sourceBTitle: title,
        snippetB: dbValue ? `Nomor DB: ${dbValue}` : 'Nomor tidak ditemukan di daftar kontak resmi.',
        confidence: entity.confidence,
      });
      return true;
    }

    case 'operating_hours': {
      if (!db.profileOperatingHoursText) return false;
      if (containsTime(db.profileOperatingHoursText, entity.value)) return false;

      await recordDocVsDbMismatch({
        chunk,
        db,
        topicHint: 'operating_hours',
        sourceBType: 'db_profile',
        sourceBTitle: 'Jam operasional DB',
        snippetB: `Jam DB: ${db.profileOperatingHoursText}`,
        confidence: entity.confidence,
      });
      return true;
    }

    case 'address': {
      if (!db.profileAddress) return false;
      const docAddr = entity.value.toLowerCase();
      const dbAddr = db.profileAddress.toLowerCase();
      if (docAddr.includes(dbAddr.substring(0, 20)) || dbAddr.includes(docAddr.substring(0, 20))) {
        return false;
      }

      await recordDocVsDbMismatch({
        chunk,
        db,
        topicHint: 'address',
        sourceBType: 'db_profile',
        sourceBTitle: 'Alamat kantor DB',
        snippetB: `Alamat DB: ${db.profileAddress}`,
        confidence: entity.confidence,
      });
      return true;
    }

    case 'office_role_holder': {
      const role = entity.subject?.toLowerCase().trim() || '';
      const holder = entity.value.toLowerCase().trim();
      if (!role || !holder) return false;

      const knownRoles = ['kepala desa', 'kades', 'lurah', 'sekretaris desa', 'sekdes'];
      if (!knownRoles.some((value) => role.includes(value))) return false;

      let matched = false;
      for (const [dbName] of db.contactsByName) {
        if (dbName.includes(holder)) {
          matched = true;
          break;
        }
      }
      if (matched) return false;

      await recordDocVsDbMismatch({
        chunk,
        db,
        topicHint: 'office_role',
        sourceBType: 'db_contact',
        sourceBTitle: `Peran ${role} di DB`,
        snippetB: `Di DB tidak ada kontak atas nama "${entity.value}" untuk peran "${role}".`,
        confidence: entity.confidence,
      });
      return true;
    }

    default:
      return false;
  }
}

async function checkServiceFactsAgainstDb(params: {
  chunk: DocChunk;
  entities: ExtractedEntity[];
  db: DbContext;
  service: ServiceCatalogItem | null;
}): Promise<number> {
  const { chunk, entities, db, service } = params;
  if (!service) return 0;

  let mismatches = 0;
  const serviceSnippet = buildServiceSnippet(service);
  const serviceEntities = entities.filter((entity) =>
    entity.kind === 'service_cost'
    || entity.kind === 'service_duration'
    || entity.kind === 'service_mode'
    || entity.kind === 'service_requirement_item',
  );

  const costEntities = serviceEntities.filter((entity) => entity.kind === 'service_cost');
  for (const entity of costEntities) {
    if (!service.estimated_cost) continue;
    if (responseMatchesServiceCost(entity.value, service.estimated_cost)) continue;

    await recordDocVsDbMismatch({
      chunk,
      db,
      topicHint: 'service_cost',
      sourceBId: service.id,
      sourceBType: 'db_service',
      sourceBTitle: `Layanan DB: ${service.name}`,
      snippetB: serviceSnippet,
      confidence: entity.confidence,
    });
    mismatches++;
  }

  if (costEntities.length === 0 && service.estimated_cost && COST_SIGNAL_REGEX.test(chunk.content) && !responseMatchesServiceCost(chunk.content, service.estimated_cost)) {
    await recordDocVsDbMismatch({
      chunk,
      db,
      topicHint: 'service_cost',
      sourceBId: service.id,
      sourceBType: 'db_service',
      sourceBTitle: `Layanan DB: ${service.name}`,
      snippetB: serviceSnippet,
      confidence: 0.7,
    });
    mismatches++;
  }

  const durationEntities = serviceEntities.filter((entity) => entity.kind === 'service_duration');
  for (const entity of durationEntities) {
    if (!service.estimated_processing_time) continue;
    if (responseMatchesServiceDuration(entity.value, service.estimated_processing_time)) continue;

    await recordDocVsDbMismatch({
      chunk,
      db,
      topicHint: 'service_duration',
      sourceBId: service.id,
      sourceBType: 'db_service',
      sourceBTitle: `Layanan DB: ${service.name}`,
      snippetB: serviceSnippet,
      confidence: entity.confidence,
    });
    mismatches++;
  }

  if (
    durationEntities.length === 0
    && service.estimated_processing_time
    && DURATION_SIGNAL_REGEX.test(chunk.content)
    && !responseMatchesServiceDuration(chunk.content, service.estimated_processing_time)
  ) {
    await recordDocVsDbMismatch({
      chunk,
      db,
      topicHint: 'service_duration',
      sourceBId: service.id,
      sourceBType: 'db_service',
      sourceBTitle: `Layanan DB: ${service.name}`,
      snippetB: serviceSnippet,
      confidence: 0.7,
    });
    mismatches++;
  }

  const modeEntities = serviceEntities.filter((entity) => entity.kind === 'service_mode');
  for (const entity of modeEntities) {
    if (!service.mode) continue;
    if (!serviceModeClaimConflicts(entity.value, service.mode)) continue;

    await recordDocVsDbMismatch({
      chunk,
      db,
      topicHint: 'service_mode',
      sourceBId: service.id,
      sourceBType: 'db_service',
      sourceBTitle: `Layanan DB: ${service.name}`,
      snippetB: serviceSnippet,
      confidence: entity.confidence,
    });
    mismatches++;
  }

  const requirements = Array.isArray(service.requirements) ? service.requirements : [];
  const requirementEntities = serviceEntities.filter((entity) => entity.kind === 'service_requirement_item');

  if (requirements.length === 0) {
    if (requirementEntities.length > 0 || (REQUIREMENT_SIGNAL_REGEX.test(chunk.content) && responseMentionsRequirementDocs(chunk.content))) {
      await recordDocVsDbMismatch({
        chunk,
        db,
        topicHint: 'service_requirement',
        sourceBId: service.id,
        sourceBType: 'db_service',
        sourceBTitle: `Layanan DB: ${service.name}`,
        snippetB: serviceSnippet,
        confidence: Math.max(...requirementEntities.map((entity) => entity.confidence), 0.7),
      });
      mismatches++;
    }

    return mismatches;
  }

  if (REQUIREMENT_SIGNAL_REGEX.test(chunk.content) && NO_REQUIREMENT_REGEX.test(chunk.content)) {
    await recordDocVsDbMismatch({
      chunk,
      db,
      topicHint: 'service_requirement',
      sourceBId: service.id,
      sourceBType: 'db_service',
      sourceBTitle: `Layanan DB: ${service.name}`,
      snippetB: serviceSnippet,
      confidence: 0.85,
    });
    mismatches++;
    return mismatches;
  }

  for (const entity of requirementEntities) {
    if (responseMatchesServiceRequirements(entity.value, requirements)) continue;

    await recordDocVsDbMismatch({
      chunk,
      db,
      topicHint: 'service_requirement',
      sourceBId: service.id,
      sourceBType: 'db_service',
      sourceBTitle: `Layanan DB: ${service.name}`,
      snippetB: serviceSnippet,
      confidence: entity.confidence,
    });
    mismatches++;
  }

  return mismatches;
}

export async function runDocVsDbForDocument(params: {
  documentId: string;
  villageId: string;
  maxChunks?: number;
  allowLlm?: boolean;
}): Promise<number> {
  const { documentId, villageId } = params;
  const maxChunks = params.maxChunks ?? 10;
  if (!documentId || !villageId) return 0;

  const chunks = await prisma.$queryRawUnsafe<DocChunk[]>(
    `SELECT id, document_id, village_id, content, document_title, section_title
       FROM ai."document_vectors"
      WHERE document_id = $1
      ORDER BY chunk_index ASC
      LIMIT $2`,
    documentId,
    maxChunks,
  ).catch((error) => {
    logger.warn('doc-vs-db: failed to load chunks', { documentId, error: error.message });
    return [] as DocChunk[];
  });

  if (chunks.length === 0) return 0;

  const db = await loadDbContext(villageId);

  const dbEmpty =
    db.phonesByNumber.size === 0
    && !db.profileOperatingHoursText
    && !db.profileAddress
    && db.services.length === 0;
  if (dbEmpty) {
    logger.info('doc-vs-db: DB context empty for village, skipping', { villageId });
    return 0;
  }

  let mismatches = 0;

  for (const chunk of chunks) {
    let entities: ExtractedEntity[] = [];
    try {
      entities = await extractEntities(chunk.content, {
        allowLlm: params.allowLlm ?? true,
        villageId,
      });
    } catch (error: any) {
      logger.warn('doc-vs-db: entity extraction failed for chunk', {
        chunkId: chunk.id,
        error: error.message,
      });
      continue;
    }

    const matchedService = findMatchedService(chunk, db);

    for (const entity of entities) {
      try {
        const flagged = await checkEntityAgainstDb(chunk, entity, db);
        if (flagged) mismatches++;
      } catch (error: any) {
        logger.warn('doc-vs-db: checkEntityAgainstDb failed', {
          chunkId: chunk.id,
          entity,
          error: error.message,
        });
      }
    }

    try {
      mismatches += await checkServiceFactsAgainstDb({
        chunk,
        entities,
        db,
        service: matchedService,
      });
    } catch (error: any) {
      logger.warn('doc-vs-db: checkServiceFactsAgainstDb failed', {
        chunkId: chunk.id,
        serviceId: matchedService?.id,
        error: error.message,
      });
    }
  }

  if (mismatches > 0) {
    logger.info('doc-vs-db: recorded mismatches', { documentId, villageId, mismatches });
  }

  return mismatches;
}
