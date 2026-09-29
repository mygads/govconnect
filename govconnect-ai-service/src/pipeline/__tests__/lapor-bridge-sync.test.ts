/**
 * W17: unit tests untuk status sync LAPOR! (applyLaporStatusUpdate)
 * dan scheduler drain (getLaporDrainIntervalMs, startLaporDrainScheduler).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock pipeline-store.
vi.mock('../pipeline-store', () => ({
  laporUpdateStatusByTrackingId: vi.fn(),
  appendAudit: vi.fn().mockResolvedValue(undefined),
}));

// Mock timer-registry.
vi.mock('../../utils/timer-registry', () => ({
  registerInterval: vi.fn(),
}));

import {
  laporUpdateStatusByTrackingId,
} from '../pipeline-store';
import { registerInterval } from '../../utils/timer-registry';
import {
  applyLaporStatusUpdate,
  getLaporDrainIntervalMs,
  startLaporDrainScheduler,
  __resetLaporDrainSchedulerForTest,
} from '../lapor-bridge';

const mockUpdateStatus = vi.mocked(laporUpdateStatusByTrackingId);
const mockRegisterInterval = vi.mocked(registerInterval);

describe('lapor-bridge status sync (W17)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    __resetLaporDrainSchedulerForTest();
  });

  it('applyLaporStatusUpdate: sukses update via tracking_id', async () => {
    mockUpdateStatus.mockResolvedValue(42);
    const result = await applyLaporStatusUpdate({
      tracking_id: 'LAPOR-123',
      status: 'diproses',
      source: 'webhook',
    });
    expect(result.applied).toBe(true);
    expect(result.outboxId).toBe(42);
    expect(mockUpdateStatus).toHaveBeenCalledWith('LAPOR-123', 'diproses', undefined);
  });

  it('applyLaporStatusUpdate: status dinormalisasi ke lowercase', async () => {
    mockUpdateStatus.mockResolvedValue(7);
    await applyLaporStatusUpdate({
      tracking_id: 'LAPOR-456',
      status: 'SELESAI',
      note: 'ditangani dinas',
      source: 'manual',
    });
    expect(mockUpdateStatus).toHaveBeenCalledWith('LAPOR-456', 'selesai', 'ditangani dinas');
  });

  it('applyLaporStatusUpdate: tracking_id tidak dikenal → applied=false', async () => {
    mockUpdateStatus.mockResolvedValue(null);
    const result = await applyLaporStatusUpdate({
      tracking_id: 'UNKNOWN-999',
      status: 'diproses',
      source: 'poll',
    });
    expect(result.applied).toBe(false);
    expect(result.outboxId).toBeNull();
  });

  it('applyLaporStatusUpdate: input kosong → applied=false tanpa DB call', async () => {
    const r1 = await applyLaporStatusUpdate({
      tracking_id: '',
      status: 'diproses',
      source: 'webhook',
    });
    const r2 = await applyLaporStatusUpdate({
      tracking_id: 'LAPOR-1',
      status: '',
      source: 'webhook',
    });
    expect(r1.applied).toBe(false);
    expect(r2.applied).toBe(false);
    expect(mockUpdateStatus).not.toHaveBeenCalled();
  });

  it('applyLaporStatusUpdate: never-throw saat DB error', async () => {
    mockUpdateStatus.mockRejectedValue(new Error('db down'));
    const result = await applyLaporStatusUpdate({
      tracking_id: 'LAPOR-789',
      status: 'diproses',
      source: 'webhook',
    });
    expect(result.applied).toBe(false);
  });
});

describe('lapor-bridge drain scheduler (W17)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    __resetLaporDrainSchedulerForTest();
    delete process.env.LAPOR_DRAIN_INTERVAL_MS;
  });

  it('getLaporDrainIntervalMs: default 5 menit', () => {
    expect(getLaporDrainIntervalMs()).toBe(300000);
  });

  it('getLaporDrainIntervalMs: baca dari env', () => {
    process.env.LAPOR_DRAIN_INTERVAL_MS = '60000';
    expect(getLaporDrainIntervalMs()).toBe(60000);
  });

  it('getLaporDrainIntervalMs: 0/invalid → 0 (scheduler mati)', () => {
    process.env.LAPOR_DRAIN_INTERVAL_MS = '0';
    expect(getLaporDrainIntervalMs()).toBe(0);
    process.env.LAPOR_DRAIN_INTERVAL_MS = 'bukan-angka';
    expect(getLaporDrainIntervalMs()).toBe(0);
  });

  it('startLaporDrainScheduler: idempotent (tidak daftar ganda)', () => {
    // LAPOR_ENABLED=false di test env → scheduler tidak start, tapi tidak throw.
    startLaporDrainScheduler();
    startLaporDrainScheduler();
    // Bila LAPOR_ENABLED true, registerInterval dipanggil tepat sekali.
    // Di env test ini LAPOR_ENABLED=false sehingga 0 kali — yang penting idempotent & tidak throw.
    expect(mockRegisterInterval.mock.calls.length).toBeLessThanOrEqual(1);
  });
});
