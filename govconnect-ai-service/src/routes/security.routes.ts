/**
 * R6 security admin routes: canary token management.
 * Internal-only (verifyInternalKey). AI proposes nothing here — planting a
 * canary is an explicit human/operator action.
 */
import crypto from 'crypto';
import { Router, type Request, type Response } from 'express';
import { internalApiKeyMatches } from '../utils/internal-auth';
import {
  registerCanaryToken,
  listCanaryTokens,
  invalidateCanaryCache,
} from '../security/canary-docs';
import { processDocumentBufferWithBilling } from '../services/document-ingest.service';

const router = Router();

function firstHeader(v: string | string[] | undefined): string | undefined {
  return Array.isArray(v) ? v[0] : v;
}

function verifyInternalKey(req: Request, res: Response, next: Function) {
  const apiKey = firstHeader(req.headers['x-internal-api-key']);
  if (!internalApiKeyMatches(apiKey)) {
    return res.status(403).json({ error: 'Unauthorized' });
  }
  next();
}

router.use(verifyInternalKey);

/** List registered canaries for a village (internal admin view). */
router.get('/canary', async (req: Request, res: Response) => {
  try {
    const villageId = String(req.query.village_id ?? req.query.villageId ?? '');
    if (!villageId) return res.status(400).json({ error: 'village_id required' });
    const tokens = await listCanaryTokens(villageId);
    res.json({ success: true, village_id: villageId, count: tokens.length, tokens });
  } catch (err: any) {
    res.status(500).json({ error: err?.message ?? 'failed to list canary tokens' });
  }
});

/**
 * Plant a canary: register the token, then index a canary document through
 * the NORMAL ingest pipeline (kb-router, secret scan, chunking, embedding —
 * no bypass). The canary is only effective once indexed.
 */
router.post('/canary/plant', async (req: Request, res: Response) => {
  try {
    const villageId = String(req.body?.village_id ?? req.body?.villageId ?? '');
    const label = String(req.body?.label ?? 'default').slice(0, 120);
    if (!villageId) return res.status(400).json({ error: 'village_id required' });

    const record = await registerCanaryToken(villageId, label);
    const documentId = `canary_${villageId}_${Date.now().toString(36)}`;
    const title = `CANARY — Penanda Keamanan Internal (${label})`;
    // Deliberately free of jam/tarif/kontak vocabulary so the R3 KB router
    // indexes it as a normal reference document instead of rejecting it.
    const text =
      `DOKUMEN CANARY — Penanda Keamanan Internal\n` +
      `Label: ${label}\n\n` +
      `Dokumen ini adalah penanda keamanan (honeytoken) untuk keperluan deteksi kebocoran data.\n` +
      `Token: ${record.token}\n\n` +
      `Token ini bersifat rahasia internal dan tidak boleh muncul dalam jawaban kepada warga ` +
      `maupun dalam dokumen desa lain. Apabila token ini terdeteksi di luar dokumen ini, ` +
      `sistem mencatat kejadian kebocoran dan memblokir respons yang bersangkutan.`;
    const fileBuffer = Buffer.from(text, 'utf8');

    const ingest = await processDocumentBufferWithBilling({
      documentId,
      fileBuffer,
      originalName: `${documentId}.txt`,
      mimeType: 'text/plain',
      title,
      category: 'keamanan',
      villageId,
      isGlobal: false,
      fileHash: crypto.createHash('sha256').update(fileBuffer).digest('hex'),
      tracePrefix: 'document',
    });

    // Keep the outbound token cache fresh for this village.
    invalidateCanaryCache(villageId);

    res.json({
      success: true,
      village_id: villageId,
      token: record.token,
      label: record.label,
      documentId,
      chunks: (ingest as any)?.chunksCount ?? 0,
      kbRoute: (ingest as any)?.kbRoute ?? 'unknown',
      message:
        'Canary planted and indexed. The token must never appear in warga-facing responses; ' +
        'the pipeline substitutes a safe reply and audits canary_token_leaked on any hit.',
    });
  } catch (err: any) {
    res.status(500).json({ error: err?.message ?? 'failed to plant canary' });
  }
});

export default router;
