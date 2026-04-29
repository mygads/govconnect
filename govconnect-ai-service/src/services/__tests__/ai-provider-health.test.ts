import { describe, it, expect, beforeEach, vi } from 'vitest';

const testState = vi.hoisted(() => {
  const rows = new Map<string, any>();
  const rowKey = (providerId: string, lane: string) => `${providerId}:${lane}`;
  const sqlText = (strings: TemplateStringsArray) => Array.from(strings).join(' ');

  const prismaMock = {
    $queryRaw: vi.fn(async (strings: TemplateStringsArray, ...values: any[]) => {
      const sql = sqlText(strings);

      if (sql.includes('INSERT INTO ai_provider_health')) {
        const [providerId, lane, failThreshold, demotedUntil] = values;
        const key = rowKey(providerId, lane);
        const existing = rows.get(key);
        const consecutiveFailures = (existing?.consecutive_failures || 0) + 1;
        const row = {
          provider_id: providerId,
          lane_type: lane,
          consecutive_failures: consecutiveFailures,
          demoted_until: consecutiveFailures >= failThreshold ? demotedUntil : existing?.demoted_until ?? null,
          last_success_at: existing?.last_success_at ?? null,
          last_failure_at: new Date(),
          probe_in_flight_until: null,
        };
        rows.set(key, row);
        return [row];
      }

      if (sql.includes('FOR UPDATE SKIP LOCKED')) {
        const [providerId, lane] = values;
        const row = rows.get(rowKey(providerId, lane));
        if (
          row?.demoted_until &&
          row.demoted_until.getTime() <= Date.now() &&
          (!row.probe_in_flight_until || row.probe_in_flight_until.getTime() < Date.now())
        ) {
          return [row];
        }
        return [];
      }

      if (sql.includes('SELECT provider_id')) {
        const [providerId, lane] = values;
        const row = rows.get(rowKey(providerId, lane));
        return row ? [row] : [];
      }

      return [];
    }),
    $executeRaw: vi.fn(async (strings: TemplateStringsArray, ...values: any[]) => {
      const sql = sqlText(strings);

      if (sql.includes('UPDATE ai_provider_health')) {
        const [probeUntil, providerId, lane] = values;
        const key = rowKey(providerId, lane);
        const row = rows.get(key);
        if (row) rows.set(key, { ...row, probe_in_flight_until: probeUntil });
        return 1;
      }

      if (sql.includes('INSERT INTO ai_provider_health')) {
        const [providerId, lane, consecutiveFailures, demotedUntil, lastSuccessAt, lastFailureAt, probeInFlightUntil] = values;
        rows.set(rowKey(providerId, lane), {
          provider_id: providerId,
          lane_type: lane,
          consecutive_failures: consecutiveFailures,
          demoted_until: demotedUntil,
          last_success_at: lastSuccessAt,
          last_failure_at: lastFailureAt,
          probe_in_flight_until: probeInFlightUntil,
        });
        return 1;
      }

      return 1;
    }),
    $transaction: vi.fn(async (callback: any) => callback(prismaMock)),
  };

  return { rows, rowKey, prismaMock };
});

vi.mock('../../lib/prisma', () => ({
  default: testState.prismaMock,
}));

const prismaMock = testState.prismaMock;

import {
  recordSuccess,
  recordFailure,
  isAvailable,
  shouldProbe,
  _clearHealthCacheForTests,
} from '../ai-provider-health.service';

const PID = 'provider-1';

describe('ai-provider-health', () => {
  beforeEach(() => {
    testState.rows.clear();
    prismaMock.$queryRaw.mockClear();
    prismaMock.$executeRaw.mockClear();
    prismaMock.$transaction.mockClear();
    _clearHealthCacheForTests();
  });

  it('starts available', async () => {
    expect(await isAvailable(PID, 'llm')).toBe(true);
  });

  it('demotes after 3 consecutive failures', async () => {
    await recordFailure(PID, 'llm');
    await recordFailure(PID, 'llm');
    expect(await isAvailable(PID, 'llm')).toBe(true);
    await recordFailure(PID, 'llm');
    expect(await isAvailable(PID, 'llm')).toBe(false);
  });

  it('success resets failure counter and demotion', async () => {
    await recordFailure(PID, 'llm');
    await recordFailure(PID, 'llm');
    await recordFailure(PID, 'llm');
    expect(await isAvailable(PID, 'llm')).toBe(false);

    await recordSuccess(PID, 'llm');
    expect(await isAvailable(PID, 'llm')).toBe(true);

    await recordFailure(PID, 'llm');
    await recordFailure(PID, 'llm');
    expect(await isAvailable(PID, 'llm')).toBe(true);
  });

  it('requires a single probe claim after cooldown lapses', async () => {
    await recordFailure(PID, 'llm');
    await recordFailure(PID, 'llm');
    await recordFailure(PID, 'llm');

    const row = testState.rows.get(testState.rowKey(PID, 'llm'));
    testState.rows.set(testState.rowKey(PID, 'llm'), {
      ...row,
      demoted_until: new Date(Date.now() - 1000),
      probe_in_flight_until: null,
    });
    _clearHealthCacheForTests();

    expect(await isAvailable(PID, 'llm')).toBe(false);
    expect(await shouldProbe(PID, 'llm')).toBe(true);
    expect(await shouldProbe(PID, 'llm')).toBe(false);

    await recordSuccess(PID, 'llm');
    expect(await isAvailable(PID, 'llm')).toBe(true);
  });
});
