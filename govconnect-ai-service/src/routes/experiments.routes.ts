/**
 * R13 experiment framework admin routes. Internal-only (verifyInternalKey).
 *
 * The gate ADVISES; promotion is always an explicit operator action.
 * Variants are immutable once the experiment leaves draft.
 */
import { Router, type Request, type Response } from 'express';
import { internalApiKeyMatches } from '../utils/internal-auth';
import {
  createExperiment,
  addVariant,
  setRamp,
  setExperimentStatus,
  listExperiments,
  evaluateRampGate,
  DEFAULT_GATE_THRESHOLDS,
  type GateMetrics,
} from '../services/experiment-framework.service';

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

router.get('/', async (req: Request, res: Response) => {
  try {
    const villageId = String(req.query.village_id ?? req.query.villageId ?? '') || undefined;
    res.json({ success: true, experiments: await listExperiments(villageId) });
  } catch (err: any) {
    res.status(500).json({ error: err?.message ?? 'failed to list experiments' });
  }
});

router.post('/', async (req: Request, res: Response) => {
  try {
    const { village_id, villageId, name, description, created_by } = req.body ?? {};
    if (!name || typeof name !== 'string') return res.status(400).json({ error: 'name required' });
    const created = await createExperiment({
      villageId: village_id ?? villageId,
      name,
      description,
      createdBy: created_by,
    });
    res.json({ success: true, ...created });
  } catch (err: any) {
    res.status(500).json({ error: err?.message ?? 'failed to create experiment' });
  }
});

router.post('/:id/variants', async (req: Request, res: Response) => {
  try {
    const { key, is_control, isControl, config } = req.body ?? {};
    if (!key || typeof key !== 'string') return res.status(400).json({ error: 'key required' });
    await addVariant({
      experimentId: req.params.id,
      key,
      isControl: is_control ?? isControl ?? false,
      config: config ?? {},
    });
    res.json({ success: true });
  } catch (err: any) {
    res.status(400).json({ error: err?.message ?? 'failed to add variant' });
  }
});

/** Ramp to 1/5/25/100. Records gate verdict (advisory) + history. */
router.post('/:id/ramp', async (req: Request, res: Response) => {
  try {
    const { pct, decided_by, gate_verdict, gate_detail } = req.body ?? {};
    if (![1, 5, 25, 100].includes(Number(pct))) {
      return res.status(400).json({ error: 'pct must be one of 1, 5, 25, 100' });
    }
    await setRamp({
      experimentId: req.params.id,
      pct: Number(pct) as 1 | 5 | 25 | 100,
      decidedBy: decided_by,
      gateVerdict: gate_verdict,
      gateDetail: gate_detail,
    });
    res.json({ success: true, pct: Number(pct) });
  } catch (err: any) {
    res.status(400).json({ error: err?.message ?? 'failed to set ramp' });
  }
});

/** Evaluate gate metrics → advisory verdict (does NOT auto-promote). */
router.post('/:id/gate', async (req: Request, res: Response) => {
  try {
    const m = (req.body?.metrics ?? {}) as Partial<GateMetrics>;
    const metrics: GateMetrics = {
      resolutionRate: Number(m.resolutionRate ?? 0),
      refusalPrecision: Number(m.refusalPrecision ?? 0),
      piiIncidents: Number(m.piiIncidents ?? 0),
      costPerTurnUsd: Number(m.costPerTurnUsd ?? 0),
    };
    const verdict = evaluateRampGate(metrics, DEFAULT_GATE_THRESHOLDS);
    res.json({ success: true, pass: verdict.pass, failures: verdict.failures, thresholds: DEFAULT_GATE_THRESHOLDS });
  } catch (err: any) {
    res.status(500).json({ error: err?.message ?? 'failed to evaluate gate' });
  }
});

router.post('/:id/pause', async (req: Request, res: Response) => {
  try {
    await setExperimentStatus(req.params.id, 'paused');
    res.json({ success: true, status: 'paused' });
  } catch (err: any) {
    res.status(400).json({ error: err?.message ?? 'failed to pause experiment' });
  }
});

/** Kill-switch: effective on the next turn (≤60s config cache). */
router.post('/:id/kill', async (req: Request, res: Response) => {
  try {
    await setExperimentStatus(req.params.id, 'killed');
    res.json({ success: true, status: 'killed' });
  } catch (err: any) {
    res.status(400).json({ error: err?.message ?? 'failed to kill experiment' });
  }
});

router.post('/:id/complete', async (req: Request, res: Response) => {
  try {
    await setExperimentStatus(req.params.id, 'completed');
    res.json({ success: true, status: 'completed' });
  } catch (err: any) {
    res.status(400).json({ error: err?.message ?? 'failed to complete experiment' });
  }
});

export default router;
