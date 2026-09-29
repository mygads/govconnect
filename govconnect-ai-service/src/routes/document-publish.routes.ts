/**
 * KB publish review gate (§5.2 arsitektur-final).
 * Mounted with the internal API key middleware in app.ts at /internal/documents.
 *
 * - POST /internal/documents/:id/publish
 *     Body: { supersede_document_ids?: string[] }
 *   Flips the document's vectors to 'published' (retrievable). Optionally marks
 *   older document versions as 'superseded' (vectors + dashboard row).
 * - POST /internal/documents/:id/withdraw
 *   Flips the document's vectors to 'withdrawn' (no longer retrievable).
 * - POST /internal/documents/:id/status { publish_status, supersede_document_ids? }
 *   General transition (e.g. published -> draft). Convenience wrappers above
 *   delegate here.
 *
 * All endpoints mirror the review state to the dashboard's knowledge_documents
 * row so the admin UI stays consistent with what retrieval actually serves.
 */
import { Router, type Request, type Response } from 'express';
import {
  setDocumentPublishStatus,
  isValidPublishStatus,
  type DocumentPublishStatus,
} from '../services/vector-db.service';
import { updateDashboardDocument } from '../services/document-ingest.service';
import logger from '../utils/logger';

const router = Router();

function docIdOf(req: Request): string {
  return String((req.params as Record<string, string>).id ?? '');
}

function supersedeIdsOf(req: Request, documentId: string): string[] {
  const rawSupersede = (req.body as any)?.supersede_document_ids;
  return Array.isArray(rawSupersede)
    ? [...new Set(rawSupersede.map(String))].filter((s) => s && s !== documentId)
    : [];
}

async function mirrorToDashboard(documentId: string, publishStatus: string): Promise<void> {
  // Best-effort: the vector flip is authoritative for retrieval; the dashboard
  // mirror keeps the admin UI honest. Failures are logged, not thrown.
  try {
    await updateDashboardDocument(documentId, { publish_status: publishStatus });
  } catch (err: any) {
    logger.warn('Failed to mirror publish_status to dashboard', {
      documentId, publishStatus, error: err?.message,
    });
  }
}

async function applyStatus(
  documentId: string,
  status: DocumentPublishStatus,
  supersedeIds: string[],
): Promise<{ chunks_updated: number; superseded: string[] }> {
  const chunksUpdated = await setDocumentPublishStatus(documentId, status);

  const superseded: string[] = [];
  if (status === 'published') {
    for (const sid of supersedeIds) {
      await setDocumentPublishStatus(sid, 'superseded');
      await mirrorToDashboard(sid, 'superseded');
      superseded.push(sid);
    }
  }

  await mirrorToDashboard(documentId, status);
  return { chunks_updated: chunksUpdated, superseded };
}

router.post('/:id/status', async (req: Request, res: Response) => {
  const documentId = docIdOf(req);
  if (!documentId) return res.status(400).json({ error: 'document id required' });

  const status = (req.body as any)?.publish_status;
  if (!isValidPublishStatus(status) || status === 'superseded') {
    // 'superseded' is never set directly — it is derived when another
    // version is published with supersede_document_ids.
    return res.status(400).json({ error: 'publish_status must be draft, published, or withdrawn' });
  }

  try {
    const result = await applyStatus(documentId, status, supersedeIdsOf(req, documentId));
    logger.info('Document status updated', { documentId, status, ...result });
    return res.json({ success: true, document_id: documentId, publish_status: status, ...result });
  } catch (err: any) {
    logger.error('Document status update failed', { documentId, status, error: err?.message });
    return res.status(500).json({ error: err?.message ?? 'status update failed' });
  }
});

router.post('/:id/publish', async (req: Request, res: Response) => {
  const documentId = docIdOf(req);
  if (!documentId) return res.status(400).json({ error: 'document id required' });

  try {
    const result = await applyStatus(documentId, 'published', supersedeIdsOf(req, documentId));
    logger.info('Document published', { documentId, ...result });
    return res.json({ success: true, document_id: documentId, ...result });
  } catch (err: any) {
    logger.error('Document publish failed', { documentId, error: err?.message });
    return res.status(500).json({ error: err?.message ?? 'publish failed' });
  }
});

router.post('/:id/withdraw', async (req: Request, res: Response) => {
  const documentId = docIdOf(req);
  if (!documentId) return res.status(400).json({ error: 'document id required' });

  try {
    const result = await applyStatus(documentId, 'withdrawn', []);
    logger.info('Document withdrawn', { documentId, ...result });
    return res.json({ success: true, document_id: documentId, ...result });
  } catch (err: any) {
    logger.error('Document withdraw failed', { documentId, error: err?.message });
    return res.status(500).json({ error: err?.message ?? 'withdraw failed' });
  }
});

export default router;
