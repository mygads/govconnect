/**
 * Doc-vs-DB pipeline.
 *
 * Extracts structured entities from document chunks and cross-checks them
 * against DB ground truth. When a document asserts a fact that disagrees
 * with DB, we persist an inconsistency record so an admin can review.
 *
 * Paired sources:
 *   phone_number      ↔ important_contacts
 *   operating_hours   ↔ village_profile.operating_hours
 *   address           ↔ village_profile.address
 *   office_role_holder↔ important_contacts (description/name match)
 *
 * service_requirement_item isn't checked here because service requirements
 * are long free-text in DB; runtime answer-policy handles them adequately.
 */

import prisma from '../lib/prisma';
import logger from '../utils/logger';
import { getImportantContacts } from './important-contacts.service';
import { getVillageProfileSummary } from './knowledge.service';
import { extractEntities, type ExtractedEntity } from './consistency-entity-extractor.service';
import { recordInconsistency, type InconsistencySeverity } from './knowledge-consistency.service';

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
  contactsByName: Map<string, string>; // normalized name -> phone
  profileOperatingHoursText: string;
  profileAddress: string;
}

async function loadDbContext(villageId: string): Promise<DbContext> {
  const [contacts, profile] = await Promise.all([
    getImportantContacts(villageId).catch(() => []),
    getVillageProfileSummary(villageId).catch(() => null),
  ]);

  const phonesByNumber = new Map<string, { name: string; description?: string | null }>();
  const contactsByName = new Map<string, string>();

  for (const c of contacts) {
    if (c.phone) {
      phonesByNumber.set(normalizePhone(c.phone), {
        name: c.name,
        description: c.description ?? null,
      });
    }
    if (c.name) {
      contactsByName.set(c.name.trim().toLowerCase(), c.phone || '');
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
  };
}

function severityForConfidence(confidence: number): InconsistencySeverity {
  if (confidence >= 0.85) return 'high';
  if (confidence >= 0.6) return 'medium';
  return 'low';
}

async function checkEntityAgainstDb(
  chunk: DocChunk,
  entity: ExtractedEntity,
  db: DbContext,
): Promise<boolean> {
  switch (entity.kind) {
    case 'phone_number': {
      const normalized = normalizePhone(entity.value);
      if (normalized.length < 7) return false; // short codes are fine
      if (db.phonesByNumber.has(normalized)) return false;

      // Phone not in DB. If the doc ties it to a role/name we know, this is a
      // mismatch — our DB has a different number for that role.
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

      await recordInconsistency({
        villageId: db.villageId,
        kind: 'doc_vs_db',
        topicHint: 'phone_number',
        sourceAId: chunk.id,
        sourceAType: 'document',
        sourceATitle: chunk.document_title || 'Dokumen',
        sourceBId: undefined,
        sourceBType: 'db_contact',
        sourceBTitle: title,
        snippetA: chunk.content,
        snippetB: dbValue ? `Nomor DB: ${dbValue}` : 'Nomor tidak ditemukan di daftar kontak resmi.',
        similarityScore: entity.confidence,
        severity: severityForConfidence(entity.confidence),
        detectedBy: 'doc_vs_db_pipeline',
      });
      return true;
    }

    case 'operating_hours': {
      if (!db.profileOperatingHoursText) return false;
      if (containsTime(db.profileOperatingHoursText, entity.value)) return false;

      await recordInconsistency({
        villageId: db.villageId,
        kind: 'doc_vs_db',
        topicHint: 'operating_hours',
        sourceAId: chunk.id,
        sourceAType: 'document',
        sourceATitle: chunk.document_title || 'Dokumen',
        sourceBId: undefined,
        sourceBType: 'db_profile',
        sourceBTitle: 'Jam operasional DB',
        snippetA: chunk.content,
        snippetB: `Jam DB: ${db.profileOperatingHoursText}`,
        similarityScore: entity.confidence,
        severity: severityForConfidence(entity.confidence),
        detectedBy: 'doc_vs_db_pipeline',
      });
      return true;
    }

    case 'address': {
      if (!db.profileAddress) return false;
      const docAddr = entity.value.toLowerCase();
      const dbAddr = db.profileAddress.toLowerCase();
      // Partial match from both directions is enough to consider "same address".
      if (docAddr.includes(dbAddr.substring(0, 20)) || dbAddr.includes(docAddr.substring(0, 20))) {
        return false;
      }

      await recordInconsistency({
        villageId: db.villageId,
        kind: 'doc_vs_db',
        topicHint: 'address',
        sourceAId: chunk.id,
        sourceAType: 'document',
        sourceATitle: chunk.document_title || 'Dokumen',
        sourceBId: undefined,
        sourceBType: 'db_profile',
        sourceBTitle: 'Alamat kantor DB',
        snippetA: chunk.content,
        snippetB: `Alamat DB: ${db.profileAddress}`,
        similarityScore: entity.confidence,
        severity: severityForConfidence(entity.confidence),
        detectedBy: 'doc_vs_db_pipeline',
      });
      return true;
    }

    case 'office_role_holder': {
      // Heuristic: if the role+name in doc doesn't match any contact
      // description/name in DB, flag it. This is noisy by nature — we only
      // flag when the role is specifically one we track.
      const role = entity.subject?.toLowerCase().trim() || '';
      const holder = entity.value.toLowerCase().trim();
      if (!role || !holder) return false;

      const knownRoles = ['kepala desa', 'kades', 'lurah', 'sekretaris desa', 'sekdes'];
      if (!knownRoles.some((r) => role.includes(r))) return false;

      let matched = false;
      for (const [dbName] of db.contactsByName) {
        if (dbName.includes(holder)) {
          matched = true;
          break;
        }
      }
      if (matched) return false;

      await recordInconsistency({
        villageId: db.villageId,
        kind: 'doc_vs_db',
        topicHint: 'office_role',
        sourceAId: chunk.id,
        sourceAType: 'document',
        sourceATitle: chunk.document_title || 'Dokumen',
        sourceBId: undefined,
        sourceBType: 'db_contact',
        sourceBTitle: `Peran ${role} di DB`,
        snippetA: chunk.content,
        snippetB: `Di DB tidak ada kontak atas nama "${entity.value}" untuk peran "${role}".`,
        similarityScore: entity.confidence,
        severity: severityForConfidence(entity.confidence),
        detectedBy: 'doc_vs_db_pipeline',
      });
      return true;
    }

    default:
      return false;
  }
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
  ).catch((err) => {
    logger.warn('doc-vs-db: failed to load chunks', { documentId, error: err.message });
    return [] as DocChunk[];
  });

  if (chunks.length === 0) return 0;

  const db = await loadDbContext(villageId);

  // If DB has absolutely nothing to compare against, there's no point running.
  const dbEmpty =
    db.phonesByNumber.size === 0
    && !db.profileOperatingHoursText
    && !db.profileAddress;
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
    } catch (err: any) {
      logger.warn('doc-vs-db: entity extraction failed for chunk', {
        chunkId: chunk.id,
        error: err.message,
      });
      continue;
    }

    for (const entity of entities) {
      try {
        const flagged = await checkEntityAgainstDb(chunk, entity, db);
        if (flagged) mismatches++;
      } catch (err: any) {
        logger.warn('doc-vs-db: checkEntityAgainstDb failed', {
          chunkId: chunk.id,
          entity,
          error: err.message,
        });
      }
    }
  }

  if (mismatches > 0) {
    logger.info('doc-vs-db: recorded mismatches', { documentId, villageId, mismatches });
  }

  return mismatches;
}
