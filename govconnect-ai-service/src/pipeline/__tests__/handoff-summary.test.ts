/**
 * A1: handoff summary builder tests (pure — no DB).
 */
import { describe, it, expect } from 'vitest';
import { buildHandoffSummary, summaryContentHash } from '../handoff-summary';

describe('buildHandoffSummary', () => {
  it('summarizes stage, intent, filled slots and last message', () => {
    const s = buildHandoffSummary({
      stage: 'COLLECT',
      slots: { intent: 'complaint', category: 'jalan', reporter_name: 'Budi', _awaitingKtpPhoto: true },
      identityLevel: 'L1',
      lastCitizenMessage: 'jalan depan rumah rusak parah',
      recentEvents: [
        { stage: 'TRIAGE', event: 'turn_completed', occurredAt: '2026-09-29T10:00:00Z' },
        { stage: 'COLLECT', event: 'slot_missing', occurredAt: '2026-09-29T10:01:00Z', payload: { slot: 'alamat' } },
      ],
      takenBy: 'admin_desa',
      reason: 'warga minta bicara petugas',
    });
    expect(s.intent).toBe('complaint');
    expect(s.stage).toBe('COLLECT');
    expect(s.filledSlots.map((x) => x.key)).toEqual(['intent', 'category', 'reporter_name']);
    // internal slots (underscore prefix) are hidden from staff view
    expect(s.filledSlots.some((x) => x.key.startsWith('_'))).toBe(false);
    expect(s.text).toContain('admin_desa');
    expect(s.text).toContain('jalan depan rumah rusak parah');
    expect(s.timeline.length).toBe(2);
  });

  it('warns when a mutation is pending confirmation', () => {
    const s = buildHandoffSummary({
      stage: 'VERIFY',
      slots: { intent: 'complaint', pendingTool: { tool: 'create_complaint' } },
      recentEvents: [],
      takenBy: 'admin',
      reason: '',
    });
    expect(s.pendingMutation).toBe(true);
    expect(s.text).toContain('MENUNGGU konfirmasi');
  });

  it('handles empty state gracefully', () => {
    const s = buildHandoffSummary({
      stage: 'TRIAGE', slots: {}, recentEvents: [], takenBy: '', reason: '',
    });
    expect(s.text).toContain('Belum ada data terisi');
    expect(s.timeline).toEqual([]);
  });

  it('truncates very long slot values', () => {
    const s = buildHandoffSummary({
      stage: 'COLLECT',
      slots: { description: 'x'.repeat(500) },
      recentEvents: [],
      takenBy: 'a', reason: '',
    });
    expect(s.filledSlots[0]!.value.endsWith('…')).toBe(true);
    expect(s.filledSlots[0]!.value.length).toBeLessThan(200);
  });

  it('summaryContentHash is stable and content-based', () => {
    const base = {
      stage: 'TRIAGE', slots: {}, recentEvents: [], takenBy: 'a', reason: '',
    };
    const h1 = summaryContentHash(buildHandoffSummary(base));
    const h2 = summaryContentHash(buildHandoffSummary(base));
    const h3 = summaryContentHash(buildHandoffSummary({ ...base, stage: 'COLLECT' }));
    expect(h1).toBe(h2);
    expect(h1).not.toBe(h3);
  });
});
