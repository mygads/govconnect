/**
 * R9: VILLAGE_KILL_SWITCH — operator kill switch per village.
 *
 * When a village id appears in the VILLAGE_KILL_SWITCH env var (comma
 * separated), the pipeline short-circuits at ingress with a static,
 * never-silent maintenance reply: no LLM calls, no tool calls, no cost.
 *
 * Semantics:
 * - Read from process.env on every call (no cache): flipping the env takes
 *   effect without a restart.
 * - A kill switch is an explicit human action, so it fails CLOSED toward
 *   the switch being honored; a missing/empty var simply means "nobody
 *   is killed".
 * - Pure functions → unit-testable.
 */

const ENV_NAME = 'VILLAGE_KILL_SWITCH';

/** Parse the env var into a set of village ids. */
export function getKilledVillages(env: NodeJS.ProcessEnv = process.env): Set<string> {
  const raw = env[ENV_NAME] ?? '';
  return new Set(
    raw
      .split(',')
      .map((s) => s.trim())
      .filter((s) => s.length > 0),
  );
}

/** True when the village is currently kill-switched. */
export function isVillageKilled(villageId: string, env: NodeJS.ProcessEnv = process.env): boolean {
  if (!villageId) return false;
  return getKilledVillages(env).has(villageId.trim());
}

/** Static reply served while a village is killed. No LLM, no tools. */
export const KILL_SWITCH_REPLY =
  'Mohon maaf, layanan asisten desa sedang dalam pemeliharaan sementara. ' +
  'Silakan hubungi kantor desa langsung atau coba lagi beberapa saat.';
