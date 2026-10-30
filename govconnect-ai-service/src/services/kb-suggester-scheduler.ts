/**
 * R5: KB suggester scheduler — menjalankan suggester secara berkala.
 *
 * AI proposes, human approves. Suggester TIDAK PERNAH jalan di hot path;
 * ia berjalan via scheduler ini (interval) atau dipicu manual via
 * POST /api/kb-proposals/suggest.
 *
 * Konfigurasi via env:
 * - KB_SUGGESTER_ENABLED=true/false (default: false)
 * - KB_SUGGESTER_INTERVAL_MS (default: 24 jam)
 * - KB_SUGGESTER_DAYS (default: 7 — window mining)
 *
 * Scheduler ini in-process (seperti lapor-drain). Untuk multi-instance,
 * pertimbangkan distributed lock atau cron eksternal.
 */

import logger from '../utils/logger';
import { registerInterval } from '../utils/timer-registry';

let suggesterSchedulerStarted = false;

function getSuggesterEnabled(): boolean {
  return String(process.env.KB_SUGGESTER_ENABLED ?? 'false').toLowerCase() === 'true';
}

function getSuggesterIntervalMs(): number {
  const v = Number(process.env.KB_SUGGESTER_INTERVAL_MS ?? 24 * 60 * 60 * 1000);
  return Number.isFinite(v) && v > 0 ? v : 24 * 60 * 60 * 1000;
}

function getSuggesterDays(): number {
  const v = Number(process.env.KB_SUGGESTER_DAYS ?? 7);
  return Number.isFinite(v) && v >= 1 ? Math.min(90, v) : 7;
}

/**
 * Start the KB suggester scheduler. Idempotent — safe to call multiple times.
 * No-op unless KB_SUGGESTER_ENABLED=true.
 */
export function startKbSuggesterScheduler(): void {
  if (suggesterSchedulerStarted) return;
  if (!getSuggesterEnabled()) {
    logger.info('[kb-suggester] scheduler not started (KB_SUGGESTER_ENABLED=false)');
    return;
  }
  const intervalMs = getSuggesterIntervalMs();
  suggesterSchedulerStarted = true;

  registerInterval(async () => {
    try {
      const { runSuggesterForAllVillages } = await import('./kb-suggester.service');
      const days = getSuggesterDays();
      const results = await runSuggesterForAllVillages({ days });
      const total = results.reduce((sum, r) => sum + r.proposalsCreated, 0);
      logger.info('[kb-suggester] scheduled run complete', {
        villages: results.length,
        proposalsCreated: total,
        days,
      });
    } catch (err: any) {
      logger.warn('[kb-suggester] scheduled run failed', {
        error: String(err?.message ?? err).slice(0, 200),
      });
    }
  }, intervalMs, 'kb-suggester');

  logger.info('[kb-suggester] scheduler started', { intervalMs });
}

/** Test hook: reset scheduler flag. */
export function __resetKbSuggesterSchedulerForTest(): void {
  suggesterSchedulerStarted = false;
}

/** Test hook: check if scheduler is running. */
export function __isKbSuggesterSchedulerStarted(): boolean {
  return suggesterSchedulerStarted;
}
