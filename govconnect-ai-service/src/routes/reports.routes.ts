/**
 * R11 monthly report routes. Internal-only (verifyInternalKey).
 * PDF export is future work — JSON + Markdown only.
 */
import { Router, type Request, type Response } from 'express';
import { internalApiKeyMatches } from '../utils/internal-auth';
import {
  fetchCaseAggregates,
  fetchAiStats,
  buildMonthlyReportData,
  renderMonthlyMarkdown,
  periodBounds,
} from '../reports/monthly-report';
import { buildDistrictRollup, renderDistrictMarkdown } from '../reports/district-rollup';

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

/**
 * GET /api/reports/monthly?village_id=…&year=2026&month=9&format=json|markdown&village_name=…
 */
router.get('/monthly', async (req: Request, res: Response) => {
  try {
    const villageId = String(req.query.village_id ?? req.query.villageId ?? '');
    const year = Number(req.query.year);
    const month = Number(req.query.month);
    const format = String(req.query.format ?? 'json').toLowerCase();
    const villageName = String(req.query.village_name ?? req.query.villageName ?? '') || undefined;
    if (!villageId) return res.status(400).json({ error: 'village_id required' });
    if (!Number.isInteger(year) || year < 2000 || year > 2100) {
      return res.status(400).json({ error: 'year must be a valid year' });
    }
    if (!Number.isInteger(month) || month < 1 || month > 12) {
      return res.status(400).json({ error: 'month must be 1-12' });
    }
    if (format !== 'json' && format !== 'markdown') {
      return res.status(400).json({ error: 'format must be json or markdown (pdf is future work)' });
    }

    const { start, end } = periodBounds(year, month);
    const [cases, ai] = await Promise.all([
      fetchCaseAggregates(villageId, year, month),
      fetchAiStats(villageId, start.toISOString(), end.toISOString()),
    ]);
    const report = buildMonthlyReportData({ villageId, villageName, year, month, cases, ai });

    if (format === 'markdown') {
      res.setHeader('content-type', 'text/markdown; charset=utf-8');
      return res.send(renderMonthlyMarkdown(report));
    }
    res.json({ success: true, report });
  } catch (err: any) {
    res.status(500).json({ error: err?.message ?? 'failed to build monthly report' });
  }
});

/**
 * A5: GET /api/reports/district?village_ids=a,b&year=2026&month=9&format=json|markdown
 *   &village_names=Desa A,Desa B (optional, same order as village_ids)
 *
 * District rollup across villages. SCOPE: the caller (dashboard) MUST only
 * include villages the requesting operator is authorized to see — this
 * endpoint rolls up exactly what it is given and cannot verify operator
 * scope itself (internal API).
 */
router.get('/district', async (req: Request, res: Response) => {
  try {
    const ids = String(req.query.village_ids ?? '')
      .split(',').map((s) => s.trim()).filter(Boolean);
    const names = String(req.query.village_names ?? '')
      .split(',').map((s) => s.trim());
    const year = Number(req.query.year);
    const month = Number(req.query.month);
    const format = String(req.query.format ?? 'json').toLowerCase();
    if (ids.length === 0) return res.status(400).json({ error: 'village_ids required (comma-separated)' });
    if (ids.length > 200) return res.status(400).json({ error: 'too many villages (max 200)' });
    if (!Number.isInteger(year) || year < 2000 || year > 2100) {
      return res.status(400).json({ error: 'year must be a valid year' });
    }
    if (!Number.isInteger(month) || month < 1 || month > 12) {
      return res.status(400).json({ error: 'month must be 1-12' });
    }
    if (format !== 'json' && format !== 'markdown') {
      return res.status(400).json({ error: 'format must be json or markdown' });
    }
    const villages = ids.map((id, i) => ({ id, name: names[i] || undefined }));
    const rollup = await buildDistrictRollup({ villages, year, month });
    if (format === 'markdown') {
      res.setHeader('content-type', 'text/markdown; charset=utf-8');
      return res.send(renderDistrictMarkdown(rollup));
    }
    res.json({ success: true, rollup });
  } catch (err: any) {
    res.status(500).json({ error: err?.message ?? 'failed to build district rollup' });
  }
});

export default router;
