/**
 * R9 — Cost/cap/kill-switch: anomaly alert.
 *
 * Aturan:
 * 1. Turn cost spike: alert jika turn cost > threshold (default $0.05).
 * 2. Daily spend spike: alert jika today > 3× rata-rata 7 hari.
 * 3. Baseline floor: tidak alert jika baseline di bawah noise floor.
 * 4. Tenant scoping: alert per village.
 * 5. Notifikasi admin: fire-and-forget, tidak mematahkan request.
 */

import { describe, it, expect } from 'vitest';
import {
  isTurnCostAnomalous,
  dailySpikeRatio,
} from '../cost-anomaly.service';

describe('R9: turn cost anomaly', () => {
  it('tidak anomalous di bawah threshold', () => {
    expect(isTurnCostAnomalous(0.01)).toBe(false);
    expect(isTurnCostAnomalous(0.04)).toBe(false);
  });

  it('anomalous di atas threshold', () => {
    expect(isTurnCostAnomalous(0.06)).toBe(true);
    expect(isTurnCostAnomalous(1.0)).toBe(true);
  });

  it('threshold custom dihormati', () => {
    expect(isTurnCostAnomalous(0.10, 0.20)).toBe(false);
    expect(isTurnCostAnomalous(0.25, 0.20)).toBe(true);
  });

  it('nol dan negatif tidak anomalous', () => {
    expect(isTurnCostAnomalous(0)).toBe(false);
    expect(isTurnCostAnomalous(-1)).toBe(false);
  });
});

describe('R9: daily spend spike', () => {
  it('tidak spike jika ≤ 3× baseline (return null)', () => {
    expect(dailySpikeRatio(0.03, 0.01)).toBeNull(); // tepat 3×, tidak alert
    expect(dailySpikeRatio(0.02, 0.01)).toBeNull(); // 2×
  });

  it('spike jika > 3× baseline (return ratio)', () => {
    expect(dailySpikeRatio(0.05, 0.01)).toBe(5);
    expect(dailySpikeRatio(1.0, 0.1)).toBe(10);
  });

  it('tidak spike jika baseline di bawah noise floor', () => {
    // Baseline terlalu kecil → null (jangan false positive)
    expect(dailySpikeRatio(0.05, 0.001)).toBeNull();
    expect(dailySpikeRatio(0.05, 0)).toBeNull();
  });

  it('tidak spike jika tidak ada baseline', () => {
    expect(dailySpikeRatio(0.05, 0)).toBeNull();
  });

  it('ratio threshold custom dihormati', () => {
    expect(dailySpikeRatio(0.05, 0.01, 5)).toBeNull(); // tepat 5×, tidak alert
    expect(dailySpikeRatio(0.06, 0.01, 5)).toBe(6); // > 5×
  });
});

describe('R9: wiring', () => {
  it('finalizeAiBillingTurn memanggil anomaly check', async () => {
    const fs = await import('fs');
    const path = await import('path');
    const src = fs.readFileSync(
      path.join(__dirname, '..', 'ai-turn-billing.service.ts'),
      'utf-8',
    );
    expect(src).toContain('checkTurnCostAnomaly');
    expect(src).toContain('checkDailySpendAnomaly');
  });

  it('cost-anomaly mengekspor fungsi check', async () => {
    const mod = await import('../cost-anomaly.service');
    expect(typeof mod.checkTurnCostAnomaly).toBe('function');
    expect(typeof mod.checkDailySpendAnomaly).toBe('function');
  });

  it('cost-anomaly mengirim notifikasi admin', async () => {
    const fs = await import('fs');
    const path = await import('path');
    const src = fs.readFileSync(
      path.join(__dirname, '..', 'cost-anomaly.service.ts'),
      'utf-8',
    );
    expect(src).toContain('notifyAdminsOfCostAnomaly');
  });
});
