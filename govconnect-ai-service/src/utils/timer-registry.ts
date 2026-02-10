/**
 * Timer Registry
 *
 * Centralized registry for all module-level setInterval timers.
 * Enables graceful shutdown by clearing all timers in one call.
 */

const timers: { id: ReturnType<typeof setInterval>; label: string }[] = [];

/**
 * Register a periodic timer. Returns the interval ID.
 */
export function registerInterval(callback: () => void, intervalMs: number, label: string): ReturnType<typeof setInterval> {
  const id = setInterval(callback, intervalMs);
  timers.push({ id, label });
  return id;
}

/**
 * Clear all registered timers (called during graceful shutdown).
 */
export function clearAllTimers(): void {
  for (const { id, label } of timers) {
    clearInterval(id);
  }
  const count = timers.length;
  timers.length = 0;
  // Avoid importing logger to keep this utility dependency-free
  if (count > 0) {
    console.log(`[TimerRegistry] Cleared ${count} interval timers`);
  }
}
