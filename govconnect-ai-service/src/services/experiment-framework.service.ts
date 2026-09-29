/**
 * R13: experiment framework — deterministic bucketing, ramp, gates, kill-switch.
 *
 * Assignment is deterministic: bucket = sha256(experiment_id:village_id:user_id)
 * mod 100. A user always lands in the same bucket, so treatment/control is
 * stable across turns (no flip-flopping mid-conversation).
 *
 * Ramp: 1 → 5 → 25 → 100 (% of traffic in treatment). Each ramp step needs a
 * gate verdict (resolution, refusal precision, PII incidents = 0, cost).
 * The gate ADVISES; promotion is an explicit operator action — the framework
 * never auto-promotes.
 *
 * Kill-switch: status → 'killed' → resolveVariant returns null everywhere
 * (control experience), effective on the next turn (60s config cache).
 *
 * Shadow mode: a variant with config.shadow=true is ASSIGNED and audited but
 * never applied — the control experience is served. True parallel shadow
 * execution (running the variant and diffing outputs) is future work; v1 is
 * honest about this in code and docs.
 *
 * v1 application point: prompt variants. A treatment variant may carry
 * config.promptSuffix, appended to the dynamic prompt context (never the
 * static system prompt, which must stay byte-identical for prefix caching).
 */
import crypto from 'crypto';
import logger from '../utils/logger';
import { appendAudit } from '../pipeline/pipeline-store';

// ── Pure: bucketing & assignment ───────────────────────────────────────────

/** Deterministic bucket in [0, 100). */
export function hashBucket(key: string): number {
  const digest = crypto.createHash('sha256').update(key, 'utf8').digest();
  return digest.readUInt32BE(0) % 100;
}

export interface VariantDef {
  key: string;
  isControl: boolean;
}

/**
 * Assign a variant. Pure + deterministic.
 * - bucket < rampPct → first non-control variant (v1: single treatment).
 * - otherwise → control.
 */
export function assignVariant(args: {
  experimentId: string;
  villageId: string;
  userId: string;
  rampPct: number;
  variants: VariantDef[];
}): string {
  const { experimentId, villageId, userId, rampPct, variants } = args;
  const control = variants.find((v) => v.isControl)?.key ?? 'control';
  const treatments = variants.filter((v) => !v.isControl);
  if (treatments.length === 0 || rampPct <= 0) return control;
  const bucket = hashBucket(`${experimentId}:${villageId}:${userId}`);
  return bucket < rampPct ? treatments[0].key : control;
}

// ── Pure: ramp gate ───────────────────────────────────────────────────────

export interface GateMetrics {
  /** Share of turns reaching a terminal resolved state. */
  resolutionRate: number;
  /** Share of refusals that were correct (not false refusals). */
  refusalPrecision: number;
  /** PII incidents detected in the window — must be 0. */
  piiIncidents: number;
  /** Mean cost per turn, USD. */
  costPerTurnUsd: number;
}

export interface GateThresholds {
  minResolutionRate: number;
  minRefusalPrecision: number;
  maxCostPerTurnUsd: number;
}

export const DEFAULT_GATE_THRESHOLDS: GateThresholds = {
  minResolutionRate: 0.75,
  minRefusalPrecision: 0.9,
  maxCostPerTurnUsd: 0.01,
};

export interface GateVerdict {
  pass: boolean;
  failures: string[];
}

/** Pure gate evaluation. PII incidents > 0 is an automatic hard fail. */
export function evaluateRampGate(
  metrics: GateMetrics,
  thresholds: GateThresholds = DEFAULT_GATE_THRESHOLDS,
): GateVerdict {
  const failures: string[] = [];
  if (metrics.piiIncidents > 0) {
    failures.push(`pii_incidents=${metrics.piiIncidents} (must be 0 — hard fail)`);
  }
  if (metrics.resolutionRate < thresholds.minResolutionRate) {
    failures.push(`resolution_rate=${metrics.resolutionRate} < ${thresholds.minResolutionRate}`);
  }
  if (metrics.refusalPrecision < thresholds.minRefusalPrecision) {
    failures.push(`refusal_precision=${metrics.refusalPrecision} < ${thresholds.minRefusalPrecision}`);
  }
  if (metrics.costPerTurnUsd > thresholds.maxCostPerTurnUsd) {
    failures.push(`cost_per_turn_usd=${metrics.costPerTurnUsd} > ${thresholds.maxCostPerTurnUsd}`);
  }
  return { pass: failures.length === 0, failures };
}

// ── DB: active experiment (lazy prisma + cache) ────────────────────────────

type PrismaLike = {
  $queryRawUnsafe: (query: string, ...args: unknown[]) => Promise<unknown>;
};
async function getPrisma(): Promise<PrismaLike> {
  const mod = await import('../lib/prisma');
  return mod.default as PrismaLike;
}

export interface ResolvedVariant {
  experimentId: string;
  experimentName: string;
  variantKey: string;
  isControl: boolean;
  /** Treatment-only prompt suffix (undefined for control). */
  promptSuffix?: string;
  /** True → assigned + audited but never applied (control served). */
  shadow: boolean;
}

interface CachedExperiment {
  experimentId: string;
  experimentName: string;
  rampPct: number;
  variants: Array<{ key: string; isControl: boolean; promptSuffix?: string; shadow: boolean }>;
  expires: number;
}

const experimentCache = new Map<string, CachedExperiment>();
const EXPERIMENT_CACHE_MS = Number(process.env.EXPERIMENT_CACHE_MS ?? 60_000);

export function invalidateExperimentCache(villageId?: string): void {
  if (villageId) experimentCache.delete(villageId);
  else experimentCache.clear();
}

async function loadActiveExperiment(villageId: string): Promise<CachedExperiment | null> {
  const now = Date.now();
  const hit = experimentCache.get(villageId);
  if (hit && hit.expires > now) return hit;
  try {
    const prisma = await getPrisma();
    const exps = (await prisma.$queryRawUnsafe(
      `SELECT id, name FROM ai.experiments
       WHERE status = 'ramping' AND (village_id = $1 OR village_id IS NULL)
       ORDER BY CASE WHEN village_id IS NULL THEN 1 ELSE 0 END, created_at DESC
       LIMIT 1`,
      villageId,
    )) as Array<{ id: string; name: string }>;
    if (exps.length === 0) {
      experimentCache.set(villageId, null as unknown as CachedExperiment);
      return null;
    }
    const exp = exps[0];
    const ramps = (await prisma.$queryRawUnsafe(
      `SELECT pct FROM ai.experiment_ramps WHERE experiment_id = $1
       ORDER BY created_at DESC LIMIT 1`,
      String(exp.id),
    )) as Array<{ pct: number }>;
    const variants = (await prisma.$queryRawUnsafe(
      `SELECT key, is_control, config FROM ai.experiment_variants WHERE experiment_id = $1`,
      String(exp.id),
    )) as Array<{ key: string; is_control: boolean; config: { promptSuffix?: string; shadow?: boolean } | null }>;
    const entry: CachedExperiment = {
      experimentId: String(exp.id),
      experimentName: String(exp.name),
      rampPct: ramps.length > 0 ? Number(ramps[0].pct) : 0,
      variants: variants.map((v) => ({
        key: String(v.key),
        isControl: Boolean(v.is_control),
        promptSuffix: v.config?.promptSuffix,
        shadow: Boolean(v.config?.shadow),
      })),
      expires: now + EXPERIMENT_CACHE_MS,
    };
    experimentCache.set(villageId, entry);
    return entry;
  } catch (err) {
    logger.warn('[experiment] active-experiment load failed (fail-soft: no variant)', {
      villageId, error: (err as Error)?.message ?? String(err),
    });
    return hit ?? null;
  }
}

/**
 * Resolve the variant for this turn. Returns null for control / no
 * experiment / killed / missing ids. Treatment assignments are audited
 * (control is the default and needs no audit row).
 */
export async function resolveExperimentVariant(
  villageId: string | undefined,
  userId: string | undefined,
  traceId: string,
): Promise<ResolvedVariant | null> {
  if (!villageId || !userId) return null;
  const exp = await loadActiveExperiment(villageId);
  if (!exp || exp.rampPct <= 0 || exp.variants.length === 0) return null;
  const variantKey = assignVariant({
    experimentId: exp.experimentId,
    villageId,
    userId,
    rampPct: exp.rampPct,
    variants: exp.variants,
  });
  const def = exp.variants.find((v) => v.key === variantKey);
  if (!def || def.isControl) return null;
  const resolved: ResolvedVariant = {
    experimentId: exp.experimentId,
    experimentName: exp.experimentName,
    variantKey: def.key,
    isControl: false,
    promptSuffix: def.promptSuffix,
    shadow: def.shadow,
  };
  try {
    await appendAudit({
      tenantId: villageId,
      traceId,
      userId,
      channel: 'whatsapp',
      stage: 'TRIAGE',
      event: def.shadow ? 'experiment_shadow_assigned' : 'experiment_assigned',
      payload: {
        experiment_id: exp.experimentId,
        experiment_name: exp.experimentName,
        variant: def.key,
        ramp_pct: exp.rampPct,
      },
    });
  } catch (err) {
    logger.warn('[experiment] assignment audit failed', { error: (err as Error)?.message ?? String(err) });
  }
  return resolved;
}

// ── Admin mutations ────────────────────────────────────────────────────────

function newId(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}_${crypto.randomBytes(4).toString('hex')}`;
}

export async function createExperiment(args: {
  villageId?: string;
  name: string;
  description?: string;
  createdBy?: string;
}): Promise<{ id: string }> {
  const prisma = await getPrisma();
  const id = newId('exp');
  await (prisma as unknown as {
    $executeRawUnsafe: (q: string, ...a: unknown[]) => Promise<unknown>;
  }).$executeRawUnsafe(
    `INSERT INTO ai.experiments (id, village_id, name, description, status, created_by)
     VALUES ($1,$2,$3,$4,'draft',$5)`,
    id, args.villageId ?? null, args.name, args.description ?? '', args.createdBy ?? 'system',
  );
  return { id };
}

export async function addVariant(args: {
  experimentId: string;
  key: string;
  isControl?: boolean;
  config?: Record<string, unknown>;
}): Promise<void> {
  const prisma = (await getPrisma()) as unknown as {
    $queryRawUnsafe: (q: string, ...a: unknown[]) => Promise<unknown>;
    $executeRawUnsafe: (q: string, ...a: unknown[]) => Promise<unknown>;
  };
  const rows = (await prisma.$queryRawUnsafe(
    `SELECT status, village_id FROM ai.experiments WHERE id = $1`, args.experimentId,
  )) as Array<{ status: string; village_id: string | null }>;
  if (rows.length === 0) throw new Error('experiment not found');
  if (rows[0].status !== 'draft') {
    throw new Error('variants are immutable once the experiment leaves draft (production pointer)');
  }
  await prisma.$executeRawUnsafe(
    `INSERT INTO ai.experiment_variants (id, experiment_id, key, is_control, config)
     VALUES ($1,$2,$3,$4,$5)`,
    newId('expv'), args.experimentId, args.key, Boolean(args.isControl), JSON.stringify(args.config ?? {}),
  );
  invalidateExperimentCache(rows[0].village_id ?? undefined);
}

export async function setRamp(args: {
  experimentId: string;
  pct: 1 | 5 | 25 | 100;
  decidedBy?: string;
  gateVerdict?: string;
  gateDetail?: Record<string, unknown>;
}): Promise<void> {
  const prisma = (await getPrisma()) as unknown as {
    $queryRawUnsafe: (q: string, ...a: unknown[]) => Promise<unknown>;
    $executeRawUnsafe: (q: string, ...a: unknown[]) => Promise<unknown>;
  };
  const rows = (await prisma.$queryRawUnsafe(
    `SELECT status, village_id FROM ai.experiments WHERE id = $1`, args.experimentId,
  )) as Array<{ status: string; village_id: string | null }>;
  if (rows.length === 0) throw new Error('experiment not found');
  if (rows[0].status === 'killed' || rows[0].status === 'completed') {
    throw new Error(`cannot ramp a ${rows[0].status} experiment`);
  }
  // One ramping experiment per village (v1).
  if (rows[0].status !== 'ramping') {
    const others = (await prisma.$queryRawUnsafe(
      `SELECT id FROM ai.experiments
       WHERE status = 'ramping'
         AND ((village_id = $1) OR (village_id IS NULL AND $1 IS NULL))
         AND id <> $2 LIMIT 1`,
      rows[0].village_id, args.experimentId,
    )) as Array<{ id: string }>;
    if (others.length > 0) throw new Error('another experiment is already ramping for this village');
  }
  await prisma.$executeRawUnsafe(
    `INSERT INTO ai.experiment_ramps (id, experiment_id, pct, gate_verdict, gate_detail, decided_by)
     VALUES ($1,$2,$3,$4,$5,$6)`,
    newId('expr'), args.experimentId, args.pct,
    args.gateVerdict ?? null, args.gateDetail ? JSON.stringify(args.gateDetail) : null,
    args.decidedBy ?? 'system',
  );
  await prisma.$executeRawUnsafe(
    `UPDATE ai.experiments SET status = 'ramping', updated_at = now() WHERE id = $1`,
    args.experimentId,
  );
  invalidateExperimentCache(rows[0].village_id ?? undefined);
}

export async function setExperimentStatus(
  experimentId: string, status: 'paused' | 'killed' | 'completed',
): Promise<void> {
  const prisma = (await getPrisma()) as unknown as {
    $queryRawUnsafe: (q: string, ...a: unknown[]) => Promise<unknown>;
    $executeRawUnsafe: (q: string, ...a: unknown[]) => Promise<unknown>;
  };
  const rows = (await prisma.$queryRawUnsafe(
    `SELECT village_id FROM ai.experiments WHERE id = $1`, experimentId,
  )) as Array<{ village_id: string | null }>;
  if (rows.length === 0) throw new Error('experiment not found');
  await prisma.$executeRawUnsafe(
    `UPDATE ai.experiments SET status = $1, updated_at = now() WHERE id = $2`,
    status, experimentId,
  );
  invalidateExperimentCache(rows[0].village_id ?? undefined);
}

export async function listExperiments(villageId?: string): Promise<Array<Record<string, unknown>>> {
  const prisma = await getPrisma();
  const rows = (await prisma.$queryRawUnsafe(
    `SELECT e.id, e.village_id, e.name, e.status, e.created_at,
            (SELECT pct FROM ai.experiment_ramps r WHERE r.experiment_id = e.id
             ORDER BY r.created_at DESC LIMIT 1) AS ramp_pct,
            (SELECT count(*) FROM ai.experiment_variants v WHERE v.experiment_id = e.id) AS variant_count
     FROM ai.experiments e
     ${villageId ? 'WHERE e.village_id = $1 OR e.village_id IS NULL' : ''}
     ORDER BY e.created_at DESC LIMIT 100`,
    ...(villageId ? [villageId] : []),
  )) as Array<Record<string, unknown>>;
  return rows;
}
