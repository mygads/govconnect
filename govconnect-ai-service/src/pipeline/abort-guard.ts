/**
 * abort-guard.ts — P1-5 no-write-after-abort.
 *
 * Lightweight per-turn cancellation primitive shared by the v1 and v2
 * pipelines. Every mutation path (complaint create, service-request create,
 * ticket update/cancel, edit-token mint) must call `assertNotAborted`
 * immediately before the write. An aborted turn fails CLOSED: the write is
 * skipped and a TurnAbortedError propagates instead.
 *
 * Why a pre-write re-check and not only the turn-entry checks:
 * a tool/handler does several awaits (catalog lookup, category resolve,
 * profile fetch) before the actual write. The abort may fire during that
 * pre-work; without the re-check the write would still land.
 */

/** Stable error code used in logs/traces for abort-blocked writes. */
export const TURN_ABORTED_BEFORE_WRITE = 'turn_aborted_before_write';

/**
 * Thrown when a mutation is attempted after the turn was aborted.
 * Fail-closed: callers must treat this as "no write happened".
 */
export class TurnAbortedError extends Error {
  readonly code = TURN_ABORTED_BEFORE_WRITE;
  readonly operation: string;

  constructor(operation: string) {
    super(`${TURN_ABORTED_BEFORE_WRITE}:${operation}`);
    this.name = 'TurnAbortedError';
    this.operation = operation;
  }
}

/** True when the signal exists and has been aborted. Absent signal = not aborted. */
export function isAborted(signal?: AbortSignal | null): boolean {
  return !!signal?.aborted;
}

/**
 * Fail-closed guard: throws TurnAbortedError when the turn was aborted.
 * Call this immediately before every DB write on a mutation path.
 */
export function assertNotAborted(
  signal: AbortSignal | null | undefined,
  operation: string,
): void {
  if (signal?.aborted) {
    throw new TurnAbortedError(operation);
  }
}

/**
 * Creates a per-turn AbortController that fires after `timeoutMs`.
 * The caller MUST call `dispose()` in a finally block so the timer does
 * not leak.
 */
export function createTurnAbortController(timeoutMs: number): {
  signal: AbortSignal;
  dispose: () => void;
} {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), Math.max(1, timeoutMs));
  if (typeof (timer as unknown as { unref?: unknown }).unref === 'function') {
    (timer as unknown as { unref: () => void }).unref();
  }
  return {
    signal: controller.signal,
    dispose: () => clearTimeout(timer),
  };
}
