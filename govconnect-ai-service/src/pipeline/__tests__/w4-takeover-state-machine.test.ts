/**
 * W4 — Takeover state machine ber-TTL.
 *
 * AI_ACTIVE → HANDOFF_PENDING → HUMAN_ACTIVE → NUDGE → (auto-handback) AI_ACTIVE
 *
 * Test pure state-transition logic tanpa DB: mock pipeline-store.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../pipeline-store', () => ({
  getTakeover: vi.fn(),
  setTakeover: vi.fn(async () => true),
  releaseTakeover: vi.fn(async () => undefined),
  loadTurnState: vi.fn(async () => null),
  recordHumanActivity: vi.fn(async () => undefined),
  findTakeoversNeedingNudge: vi.fn(async () => []),
}));

vi.mock('../handoff-summary', () => ({
  buildHandoffSummary: vi.fn(() => 'mock'),
  saveHandoffSummary: vi.fn(async () => true),
  loadRecentUserEvents: vi.fn(async () => []),
}));

vi.mock('../../services/channel-client.service', () => ({
  isUserInTakeover: vi.fn(async () => false),
}));

import {
  isTakeoverActive, takeOver, requestHandoff, onHumanMessage,
  getTakeoversNeedingNudge, buildNudgeCopy, buildAutoHandbackCopy,
} from '../takeover';
import {
  getTakeover, setTakeover, recordHumanActivity, findTakeoversNeedingNudge,
} from '../pipeline-store';

describe('W4 takeover state machine', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('AI_ACTIVE: tidak ada takeover → active=false, state=AI_ACTIVE', async () => {
    vi.mocked(getTakeover).mockResolvedValue(null);
    const res = await isTakeoverActive('T1', 'U1');
    expect(res.active).toBe(false);
    expect(res.state).toBe('AI_ACTIVE');
  });

  it('HANDOFF_PENDING: bukan takeover aktif (AI masih boleh bicara)', async () => {
    vi.mocked(getTakeover).mockResolvedValue({
      takenBy: 'system', reason: 'auto-handoff',
      takenAt: new Date().toISOString(), expiresAt: new Date(Date.now() + 3600000).toISOString(),
      state: 'HANDOFF_PENDING', lastHumanActivityAt: null, nudgeSentAt: null,
    });
    const res = await isTakeoverActive('T1', 'U1');
    expect(res.active).toBe(false);
    expect(res.state).toBe('HANDOFF_PENDING');
  });

  it('HUMAN_ACTIVE: takeover aktif, AI diam', async () => {
    vi.mocked(getTakeover).mockResolvedValue({
      takenBy: 'admin1', reason: 'manual',
      takenAt: new Date().toISOString(), expiresAt: new Date(Date.now() + 3600000).toISOString(),
      state: 'HUMAN_ACTIVE', lastHumanActivityAt: new Date().toISOString(), nudgeSentAt: null,
    });
    const res = await isTakeoverActive('T1', 'U1');
    expect(res.active).toBe(true);
    expect(res.takenBy).toBe('admin1');
    expect(res.state).toBe('HUMAN_ACTIVE');
  });

  it('NUDGE: takeover tetap aktif tapi state=NUDGE', async () => {
    vi.mocked(getTakeover).mockResolvedValue({
      takenBy: 'admin1', reason: 'manual',
      takenAt: new Date(Date.now() - 3600000).toISOString(),
      expiresAt: new Date(Date.now() + 3600000).toISOString(),
      state: 'NUDGE',
      lastHumanActivityAt: new Date(Date.now() - 35 * 60000).toISOString(),
      nudgeSentAt: new Date().toISOString(),
    });
    const res = await isTakeoverActive('T1', 'U1');
    expect(res.active).toBe(true);
    expect(res.state).toBe('NUDGE');
  });

  it('takeOver: set state=HUMAN_ACTIVE', async () => {
    await takeOver('T1', 'U1', 'admin1', 'manual');
    expect(vi.mocked(setTakeover)).toHaveBeenCalledWith(
      'T1', 'U1', 'admin1', 'manual', expect.any(Number), 'whatsapp', 'HUMAN_ACTIVE',
    );
  });

  it('requestHandoff: set state=HANDOFF_PENDING', async () => {
    await requestHandoff('T1', 'U1', 'auto-handoff test');
    expect(vi.mocked(setTakeover)).toHaveBeenCalledWith(
      'T1', 'U1', 'system', 'auto-handoff test', expect.any(Number), 'whatsapp', 'HANDOFF_PENDING',
    );
  });

  it('onHumanMessage: record aktivitas manusia', async () => {
    await onHumanMessage('T1', 'U1', 'whatsapp');
    expect(vi.mocked(recordHumanActivity)).toHaveBeenCalledWith('T1', 'U1', 'whatsapp');
  });

  it('getTakeoversNeedingNudge: delegasi ke store', async () => {
    vi.mocked(findTakeoversNeedingNudge).mockResolvedValue([
      { tenantId: 'T1', userId: 'U1', channel: 'whatsapp', takenBy: 'admin1' },
    ]);
    const res = await getTakeoversNeedingNudge(10);
    expect(res).toHaveLength(1);
    expect(res[0].takenBy).toBe('admin1');
  });

  it('buildNudgeCopy: menyebut 30 menit dan 10 menit', async () => {
    const copy = buildNudgeCopy('6281234567890');
    expect(copy).toMatch(/30 menit/);
    expect(copy).toMatch(/10 menit/);
  });

  it('buildAutoHandbackCopy: menyebut pengembalian otomatis', async () => {
    const copy = buildAutoHandbackCopy();
    expect(copy.toLowerCase()).toMatch(/otomatis/);
  });
});
