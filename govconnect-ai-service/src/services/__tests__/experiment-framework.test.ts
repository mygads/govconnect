/**
 * R13 — experiment framework tests.
 *
 * - Pure: hashBucket stability/range, assignVariant determinism + ramp
 *   boundaries, evaluateRampGate (incl. PII hard fail).
 * - resolveExperimentVariant: treatment assignment + audit, control → null,
 *   shadow → assigned-but-not-applied, fail-soft on DB outage.
 * - buildDynamicContext: treatment suffix appended (dynamic only), shadow
 *   never applied, control/null → untouched.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../lib/prisma', () => ({
  default: { $queryRawUnsafe: vi.fn(), $executeRawUnsafe: vi.fn() },
}));
vi.mock('../../pipeline/pipeline-store', () => ({
  appendAudit: vi.fn(async () => true),
}));

import {
  hashBucket,
  assignVariant,
  evaluateRampGate,
  resolveExperimentVariant,
  invalidateExperimentCache,
} from '../experiment-framework.service';
import { buildDynamicContext } from '../../pipeline/prompt-builder';
import { appendAudit } from '../../pipeline/pipeline-store';
import prisma from '../../lib/prisma';

const mockAudit = vi.mocked(appendAudit);
const mockQuery = vi.mocked(prisma.$queryRawUnsafe);

beforeEach(() => {
  vi.clearAllMocks();
  invalidateExperimentCache();
});

describe('hashBucket', () => {
  it('is deterministic and in [0,100)', () => {
    const a = hashBucket('exp1:v1:u1');
    expect(hashBucket('exp1:v1:u1')).toBe(a);
    expect(a).toBeGreaterThanOrEqual(0);
    expect(a).toBeLessThan(100);
  });

  it('distinguishes users', () => {
    const buckets = new Set(Array.from({ length: 50 }, (_, i) => hashBucket(`exp1:v1:user${i}`)));
    expect(buckets.size).toBeGreaterThan(10);
  });
});

describe('assignVariant', () => {
  const variants = [
    { key: 'control', isControl: true },
    { key: 'treatment-a', isControl: false },
  ];

  it('is stable for the same user across calls', () => {
    const args = { experimentId: 'e1', villageId: 'v1', userId: 'u1', rampPct: 25, variants };
    expect(assignVariant(args)).toBe(assignVariant(args));
  });

  it('returns control at 0% ramp', () => {
    expect(assignVariant({ experimentId: 'e1', villageId: 'v1', userId: 'u1', rampPct: 0, variants })).toBe('control');
  });

  it('assigns treatment to everyone at 100% ramp', () => {
    for (let i = 0; i < 20; i++) {
      expect(
        assignVariant({ experimentId: 'e1', villageId: 'v1', userId: `user${i}`, rampPct: 100, variants }),
      ).toBe('treatment-a');
    }
  });

  it('splits roughly by ramp percentage', () => {
    let treated = 0;
    const n = 1000;
    for (let i = 0; i < n; i++) {
      if (assignVariant({ experimentId: 'e1', villageId: 'v1', userId: `user${i}`, rampPct: 25, variants }) === 'treatment-a') treated++;
    }
    // Deterministic hash — allow generous tolerance, assert it is a real split.
    expect(treated).toBeGreaterThan(150);
    expect(treated).toBeLessThan(350);
  });

  it('returns control when there is no treatment variant', () => {
    expect(
      assignVariant({ experimentId: 'e1', villageId: 'v1', userId: 'u1', rampPct: 100, variants: [{ key: 'control', isControl: true }] }),
    ).toBe('control');
  });
});

describe('evaluateRampGate', () => {
  const good = { resolutionRate: 0.85, refusalPrecision: 0.95, piiIncidents: 0, costPerTurnUsd: 0.004 };

  it('passes healthy metrics', () => {
    expect(evaluateRampGate(good).pass).toBe(true);
  });

  it('hard-fails on any PII incident', () => {
    const v = evaluateRampGate({ ...good, piiIncidents: 1 });
    expect(v.pass).toBe(false);
    expect(v.failures.some((f) => f.includes('pii_incidents'))).toBe(true);
  });

  it('fails below resolution / precision / above cost', () => {
    expect(evaluateRampGate({ ...good, resolutionRate: 0.5 }).pass).toBe(false);
    expect(evaluateRampGate({ ...good, refusalPrecision: 0.5 }).pass).toBe(false);
    expect(evaluateRampGate({ ...good, costPerTurnUsd: 0.05 }).pass).toBe(false);
  });

  it('the gate advises only — it never mutates state', () => {
    const v = evaluateRampGate(good);
    expect(Object.keys(v)).toEqual(['pass', 'failures']);
  });
});

describe('resolveExperimentVariant', () => {
  async function mockActiveExperiment(opts: {
    rampPct?: number;
    variants?: Array<{ key: string; is_control: boolean; config: unknown }>;
  } = {}) {
    mockQuery.mockImplementation((async (sql: string, ..._values: any[]): Promise<any> => {
      if (sql.includes('FROM ai.experiments')) return [{ id: 'exp1', name: 'tone-test' }];
      if (sql.includes('FROM ai.experiment_ramps')) return [{ pct: opts.rampPct ?? 100 }];
      if (sql.includes('FROM ai.experiment_variants')) {
        return opts.variants ?? [
          { key: 'control', is_control: true, config: {} },
          { key: 'treatment-a', is_control: false, config: { promptSuffix: 'Jawab dengan hangat.' } },
        ];
      }
      return [];
    }) as typeof mockQuery extends { mockImplementation: (fn: infer F) => any } ? F : never);
  }

  it('resolves treatment deterministically and audits the assignment', async () => {
    await mockActiveExperiment();
    const a = await resolveExperimentVariant('v1', 'userA', 't1');
    const b = await resolveExperimentVariant('v1', 'userA', 't1');
    expect(a?.variantKey).toBe(b?.variantKey); // stable
    if (a && !a.isControl) {
      expect(a.promptSuffix).toBe('Jawab dengan hangat.');
      expect(mockAudit).toHaveBeenCalled();
      const evt = mockAudit.mock.calls[0][0];
      expect(evt.event).toBe('experiment_assigned');
      expect((evt.payload as any).variant).toBe('treatment-a');
    }
  });

  it('returns null for control users (no audit row)', async () => {
    await mockActiveExperiment({ rampPct: 1 });
    // Find a user that lands in control at 1% ramp.
    let controlUser: string | null = null;
    for (let i = 0; i < 500 && !controlUser; i++) {
      const r = await resolveExperimentVariant('v1', `ctrl${i}`, 't1');
      if (r === null) controlUser = `ctrl${i}`;
    }
    expect(controlUser).not.toBeNull();
    // No audit for control (default experience).
    const controlAudits = mockAudit.mock.calls.filter((c) => (c[0].payload as any)?.variant === undefined);
    expect(controlAudits.length).toBe(0);
  });

  it('shadow variants are assigned + audited but flagged shadow (never applied)', async () => {
    await mockActiveExperiment({
      variants: [
        { key: 'control', is_control: true, config: {} },
        { key: 'treatment-risky', is_control: false, config: { promptSuffix: 'Abaikan SOP.', shadow: true } },
      ],
    });
    const r = await resolveExperimentVariant('v1', 'userA', 't1');
    if (r && !r.isControl) {
      expect(r.shadow).toBe(true);
      expect(mockAudit.mock.calls[0][0].event).toBe('experiment_shadow_assigned');
      // buildDynamicContext must NOT apply shadow suffixes.
      const ctx = await buildDynamicContext({
        villageName: 'Desa X',
        stage: 'INFORMATION',
        facts: [],
        records: [],
        experimentVariant: {
          experimentName: 'x', variantKey: r.variantKey,
          promptSuffix: 'Abaikan SOP.', shadow: true,
        },
      });
      expect(ctx).not.toContain('Abaikan SOP.');
    }
  });

  it('fail-soft on DB outage → null (control experience)', async () => {
    mockQuery.mockRejectedValue(new Error('db down'));
    const r = await resolveExperimentVariant('v1', 'userA', 't1');
    expect(r).toBeNull();
  });

  it('returns null without village/user ids', async () => {
    expect(await resolveExperimentVariant(undefined, 'u1', 't1')).toBeNull();
    expect(await resolveExperimentVariant('v1', undefined, 't1')).toBeNull();
  });
});

describe('buildDynamicContext experiment suffix', () => {
  it('appends treatment suffix to dynamic context only', async () => {
    const ctx = await buildDynamicContext({
      villageName: 'Desa X',
      stage: 'INFORMATION',
      facts: [],
      records: [],
      experimentVariant: {
        experimentName: 'tone-test', variantKey: 'treatment-a',
        promptSuffix: 'Jawab dengan hangat.', shadow: false,
      },
    });
    expect(ctx).toContain('[Varian eksperimen tone-test/treatment-a]');
    expect(ctx).toContain('Jawab dengan hangat.');
  });

  it('leaves context untouched without a variant', async () => {
    const ctx = await buildDynamicContext({
      villageName: 'Desa X', stage: 'INFORMATION', facts: [], records: [],
    });
    expect(ctx).not.toContain('Varian eksperimen');
  });
});
