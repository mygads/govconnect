/**
 * Knowledge Consistency API Routes
 *
 * Admin-facing endpoints for reviewing and managing inconsistencies
 * detected by the knowledge-consistency pipelines.
 *
 * All routes require internal auth (mounted via internalAuthMiddleware at app.ts).
 *
 * - POST /api/knowledge-consistency/scan        Trigger a full village scan
 * - POST /api/knowledge-consistency/scan/doc    Trigger scan for a specific document
 * - GET  /api/knowledge-consistency             List inconsistencies (filter + paginate)
 * - GET  /api/knowledge-consistency/summary     Aggregate counts by kind/severity/status
 * - POST /api/knowledge-consistency/:id/resolve Mark as resolved or ignored
 * - GET  /api/knowledge-consistency/ui          Minimal HTML viewer (human-readable)
 */

import { Router, Request, Response } from 'express';
import logger from '../utils/logger';
import prisma from '../lib/prisma';
import {
  listInconsistencies,
  runDocVsDocForDocument,
  runKbVsKbSweep,
  updateInconsistencyStatus,
  type InconsistencyKind,
  type InconsistencySeverity,
  type InconsistencyStatus,
} from '../services/knowledge-consistency.service';
import { runDocVsDbForDocument } from '../services/doc-vs-db-pipeline.service';
import {
  listRuntimeGroundingMismatches,
  summarizeRuntimeGroundingMismatches,
  updateRuntimeGroundingMismatchStatus,
  type RuntimeGroundingMismatchKind,
  type RuntimeGroundingMismatchStatus,
} from '../services/runtime-grounding-mismatch.service';

const router = Router();

const VALID_KINDS: ReadonlySet<InconsistencyKind> = new Set(['doc_vs_doc', 'doc_vs_db', 'kb_vs_kb']);
const VALID_SEVERITIES: ReadonlySet<InconsistencySeverity> = new Set(['low', 'medium', 'high']);
const VALID_STATUSES: ReadonlySet<InconsistencyStatus> = new Set(['open', 'resolved', 'ignored']);
const VALID_RUNTIME_KINDS: ReadonlySet<RuntimeGroundingMismatchKind> = new Set([
  'phone_not_in_db',
  'operating_hour_mismatch',
  'office_address_mismatch',
  'service_cost_mismatch',
  'service_duration_mismatch',
  'service_mode_mismatch',
  'service_availability_mismatch',
  'service_requirement_mismatch',
]);
const VALID_RUNTIME_STATUSES: ReadonlySet<RuntimeGroundingMismatchStatus> = new Set(['open', 'resolved', 'ignored']);

router.get('/', async (req: Request, res: Response) => {
  try {
    const { villageId, kind, status, severity } = req.query as Record<string, string | undefined>;
    const limit = parseInt((req.query.limit as string) || '50', 10);
    const offset = parseInt((req.query.offset as string) || '0', 10);

    const result = await listInconsistencies({
      villageId,
      kind: kind && VALID_KINDS.has(kind as InconsistencyKind) ? (kind as InconsistencyKind) : undefined,
      status: status && VALID_STATUSES.has(status as InconsistencyStatus) ? (status as InconsistencyStatus) : undefined,
      severity:
        severity && VALID_SEVERITIES.has(severity as InconsistencySeverity)
          ? (severity as InconsistencySeverity)
          : undefined,
      limit: Number.isFinite(limit) ? limit : 50,
      offset: Number.isFinite(offset) ? offset : 0,
    });

    res.json({ success: true, ...result });
  } catch (error: any) {
    logger.error('knowledge-consistency list failed', { error: error.message });
    res.status(500).json({ success: false, error: error.message });
  }
});

router.get('/summary', async (req: Request, res: Response) => {
  try {
    const { villageId } = req.query as Record<string, string | undefined>;
    const rows = await (prisma as any).ai_knowledge_inconsistencies.groupBy({
      by: ['kind', 'severity', 'status'],
      where: villageId ? { village_id: villageId } : undefined,
      _count: { _all: true },
    });

    const summary = {
      total: rows.reduce((acc: number, row: any) => acc + row._count._all, 0),
      byKind: {} as Record<string, number>,
      bySeverity: {} as Record<string, number>,
      byStatus: {} as Record<string, number>,
    };
    for (const row of rows as any[]) {
      summary.byKind[row.kind] = (summary.byKind[row.kind] || 0) + row._count._all;
      summary.bySeverity[row.severity] = (summary.bySeverity[row.severity] || 0) + row._count._all;
      summary.byStatus[row.status] = (summary.byStatus[row.status] || 0) + row._count._all;
    }

    res.json({ success: true, summary });
  } catch (error: any) {
    logger.error('knowledge-consistency summary failed', { error: error.message });
    res.status(500).json({ success: false, error: error.message });
  }
});

router.post('/scan', async (req: Request, res: Response) => {
  try {
    const { villageId, includeKbSweep } = req.body || {};
    if (!villageId || typeof villageId !== 'string') {
      res.status(400).json({ success: false, error: 'villageId required' });
      return;
    }

    // Queue-like trigger: gather all documents for village, run each.
    const documentIds = await prisma.$queryRawUnsafe<Array<{ document_id: string }>>(
      `SELECT DISTINCT document_id FROM ai."document_vectors" WHERE village_id = $1 LIMIT 500`,
      villageId,
    ).catch(() => [] as Array<{ document_id: string }>);

    let docVsDoc = 0;
    let docVsDb = 0;
    for (const row of documentIds) {
      docVsDoc += await runDocVsDocForDocument({
        documentId: row.document_id,
        villageId,
      });
      docVsDb += await runDocVsDbForDocument({
        documentId: row.document_id,
        villageId,
      });
    }

    let kbVsKb = 0;
    if (includeKbSweep) {
      kbVsKb = await runKbVsKbSweep({ villageId });
    }

    res.json({
      success: true,
      scannedDocuments: documentIds.length,
      recorded: { doc_vs_doc: docVsDoc, doc_vs_db: docVsDb, kb_vs_kb: kbVsKb },
    });
  } catch (error: any) {
    logger.error('knowledge-consistency scan failed', { error: error.message });
    res.status(500).json({ success: false, error: error.message });
  }
});

router.post('/scan/doc', async (req: Request, res: Response) => {
  try {
    const { documentId, villageId } = req.body || {};
    if (!documentId || typeof documentId !== 'string') {
      res.status(400).json({ success: false, error: 'documentId required' });
      return;
    }
    const docVsDoc = await runDocVsDocForDocument({
      documentId,
      villageId: villageId || null,
    });
    const docVsDb = villageId
      ? await runDocVsDbForDocument({ documentId, villageId })
      : 0;

    res.json({
      success: true,
      documentId,
      recorded: { doc_vs_doc: docVsDoc, doc_vs_db: docVsDb },
    });
  } catch (error: any) {
    logger.error('knowledge-consistency scan doc failed', { error: error.message });
    res.status(500).json({ success: false, error: error.message });
  }
});

router.get('/runtime', async (req: Request, res: Response) => {
  try {
    const { villageId, kind, status, entityType, traceId } = req.query as Record<string, string | undefined>;
    const limit = parseInt((req.query.limit as string) || '50', 10);
    const offset = parseInt((req.query.offset as string) || '0', 10);

    const result = await listRuntimeGroundingMismatches({
      villageId,
      kind: kind && VALID_RUNTIME_KINDS.has(kind as RuntimeGroundingMismatchKind)
        ? (kind as RuntimeGroundingMismatchKind)
        : undefined,
      status: status && VALID_RUNTIME_STATUSES.has(status as RuntimeGroundingMismatchStatus)
        ? (status as RuntimeGroundingMismatchStatus)
        : undefined,
      entityType,
      traceId,
      limit: Number.isFinite(limit) ? limit : 50,
      offset: Number.isFinite(offset) ? offset : 0,
    });

    res.json({ success: true, ...result });
  } catch (error: any) {
    logger.error('runtime grounding mismatch list failed', { error: error.message });
    res.status(500).json({ success: false, error: error.message });
  }
});

router.get('/runtime/summary', async (req: Request, res: Response) => {
  try {
    const { villageId } = req.query as Record<string, string | undefined>;
    const summary = await summarizeRuntimeGroundingMismatches(villageId);
    res.json({ success: true, summary });
  } catch (error: any) {
    logger.error('runtime grounding mismatch summary failed', { error: error.message });
    res.status(500).json({ success: false, error: error.message });
  }
});

router.post('/runtime/:id/resolve', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { status, resolvedBy, resolutionNote, villageId } = req.body || {};
    if (!VALID_RUNTIME_STATUSES.has(status)) {
      res.status(400).json({ success: false, error: 'status must be open|resolved|ignored' });
      return;
    }
    const item = await updateRuntimeGroundingMismatchStatus(
      id,
      {
        status,
        resolvedBy,
        resolutionNote,
      },
      typeof villageId === 'string' && villageId.trim() ? villageId.trim() : undefined,
    );
    res.json({ success: true, item });
  } catch (error: any) {
    logger.error('runtime grounding mismatch resolve failed', { error: error.message, code: error.code });
    if (error?.code === 'NOT_FOUND') {
      res.status(404).json({ success: false, error: 'Runtime mismatch not found' });
      return;
    }
    if (error?.code === 'FORBIDDEN') {
      res.status(403).json({ success: false, error: 'Forbidden' });
      return;
    }
    res.status(500).json({ success: false, error: error.message });
  }
});

router.post('/:id/resolve', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { status, resolvedBy, resolutionNote, villageId } = req.body || {};
    if (!VALID_STATUSES.has(status)) {
      res.status(400).json({ success: false, error: 'status must be open|resolved|ignored' });
      return;
    }
    const updated = await updateInconsistencyStatus(
      id,
      {
        status,
        resolvedBy,
        resolutionNote,
      },
      typeof villageId === 'string' && villageId.trim() ? villageId.trim() : undefined,
    );
    res.json({ success: true, item: updated });
  } catch (error: any) {
    logger.error('knowledge-consistency resolve failed', { error: error.message, code: error.code });
    if (error?.code === 'NOT_FOUND') {
      res.status(404).json({ success: false, error: 'Inconsistency not found' });
      return;
    }
    if (error?.code === 'FORBIDDEN') {
      res.status(403).json({ success: false, error: 'Forbidden' });
      return;
    }
    res.status(500).json({ success: false, error: error.message });
  }
});

// ── Minimal HTML viewer ─────────────────────────────────────────────────
// Admin can hit /api/knowledge-consistency/ui?villageId=... (behind the
// internal-auth middleware) to see open items without needing a separate
// dashboard. Intentionally inline + no JS framework so it works anywhere.
router.get('/ui', async (req: Request, res: Response) => {
  try {
    const { villageId, status = 'open' } = req.query as Record<string, string | undefined>;
    const { items, total } = await listInconsistencies({
      villageId,
      status: VALID_STATUSES.has(status as InconsistencyStatus) ? (status as InconsistencyStatus) : 'open',
      limit: 100,
    });

    const rows = items
      .map((row: any) => {
        const snippetA = (row.snippet_a || '').replace(/</g, '&lt;').replace(/\n/g, '<br>');
        const snippetB = (row.snippet_b || '').replace(/</g, '&lt;').replace(/\n/g, '<br>');
        return `
      <tr>
        <td style="vertical-align:top; border-bottom:1px solid #eee; padding:8px 6px; font-size:12px; color:#555;">
          ${new Date(row.detected_at).toISOString().replace('T', ' ').substring(0, 16)}
        </td>
        <td style="vertical-align:top; border-bottom:1px solid #eee; padding:8px 6px; font-size:12px;">
          <b>${row.kind}</b><br>
          <span style="color:#999">${row.topic_hint || '-'}</span>
        </td>
        <td style="vertical-align:top; border-bottom:1px solid #eee; padding:8px 6px; font-size:12px;">
          <span style="padding:2px 6px; border-radius:4px; background:${severityColor(row.severity)}; color:white">${row.severity}</span>
        </td>
        <td style="vertical-align:top; border-bottom:1px solid #eee; padding:8px 6px; font-size:12px;">
          <b>${escapeHtml(row.source_a_title || '-')}</b>
          <div style="background:#fafafa; padding:6px; border:1px solid #eee; margin-top:4px; max-width:380px; white-space:pre-wrap; font-family:ui-monospace,monospace; font-size:11px;">${snippetA}</div>
        </td>
        <td style="vertical-align:top; border-bottom:1px solid #eee; padding:8px 6px; font-size:12px;">
          <b>${escapeHtml(row.source_b_title || '-')}</b>
          <div style="background:#fafafa; padding:6px; border:1px solid #eee; margin-top:4px; max-width:380px; white-space:pre-wrap; font-family:ui-monospace,monospace; font-size:11px;">${snippetB}</div>
        </td>
        <td style="vertical-align:top; border-bottom:1px solid #eee; padding:8px 6px; font-size:12px;">
          <form method="post" action="/api/knowledge-consistency/${row.id}/resolve" style="display:inline">
            <input type="hidden" name="status" value="resolved">
            <button type="submit" style="padding:3px 8px; font-size:11px;">Resolve</button>
          </form>
          <form method="post" action="/api/knowledge-consistency/${row.id}/resolve" style="display:inline; margin-left:4px;">
            <input type="hidden" name="status" value="ignored">
            <button type="submit" style="padding:3px 8px; font-size:11px;">Ignore</button>
          </form>
        </td>
      </tr>`;
      })
      .join('');

    const html = `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<title>Knowledge Consistency — ${escapeHtml(villageId || 'all')}</title>
<style>
  body { font-family: system-ui, -apple-system, sans-serif; margin: 20px; color: #222; background:#fff; }
  h1 { font-size: 18px; margin: 0 0 6px; }
  .meta { color: #666; font-size: 12px; margin-bottom: 14px; }
  table { border-collapse: collapse; width: 100%; }
  th { text-align:left; font-size:11px; text-transform:uppercase; letter-spacing:0.05em; color:#666; padding:8px 6px; border-bottom:2px solid #ddd; }
  .nav a { margin-right: 8px; font-size: 12px; color: #0355c8; text-decoration: none; }
  .nav a:hover { text-decoration: underline; }
</style>
</head>
<body>
  <h1>Knowledge Consistency Review</h1>
  <div class="meta">Village: <b>${escapeHtml(villageId || '-')}</b> &nbsp;·&nbsp; Status: <b>${escapeHtml(status || 'open')}</b> &nbsp;·&nbsp; Total: <b>${total}</b></div>
  <div class="nav">
    <a href="?villageId=${encodeURIComponent(villageId || '')}&status=open">Open</a>
    <a href="?villageId=${encodeURIComponent(villageId || '')}&status=resolved">Resolved</a>
    <a href="?villageId=${encodeURIComponent(villageId || '')}&status=ignored">Ignored</a>
  </div>
  <table>
    <thead>
      <tr>
        <th>Detected</th>
        <th>Kind / Topic</th>
        <th>Severity</th>
        <th>Source A</th>
        <th>Source B / DB</th>
        <th>Action</th>
      </tr>
    </thead>
    <tbody>
      ${rows || `<tr><td colspan="6" style="padding:20px; color:#888; font-size:13px; text-align:center;">Belum ada inkonsistensi untuk filter ini.</td></tr>`}
    </tbody>
  </table>
</body>
</html>`;

    res.setHeader('content-type', 'text/html; charset=utf-8');
    res.send(html);
  } catch (error: any) {
    logger.error('knowledge-consistency ui failed', { error: error.message });
    res.status(500).send(`<pre>Error: ${error.message}</pre>`);
  }
});

function severityColor(severity: string): string {
  switch (severity) {
    case 'high': return '#d93025';
    case 'medium': return '#e37400';
    case 'low': return '#5f6368';
    default: return '#888';
  }
}

function escapeHtml(raw: string): string {
  return String(raw || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export default router;
