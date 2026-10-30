/**
 * village-identity.service — per-village AI identity settings.
 *
 * Sumber: dashboard `/api/internal/village-ai-identity` (tabel
 * `village_behavior_configs`: ai_identity_disclosure, ai_persona_name,
 * ai_persona_description). Diatur admin desa lewat dashboard
 * "Pengaturan → Identitas AI".
 *
 * - Cache in-memory 60 detik per village (pengaturan tidak perlu real-time).
 * - Fail-open ke DEFAULT_IDENTITY bila dashboard tidak terjangkau:
 *   disclosure=true (transparan), nama "Gana". Tidak pernah throw.
 * - config/env dan logger di-import LAZY (bukan top-level): config/env
 *   menjalankan validateEnv() saat modul dievaluasi, yang memanggil
 *   logger.warn bila lane belum terkonfigurasi — itu merusak unit test yang
 *   me-mock utils/logger (TDZ warnSpy) dan menambah side effect import.
 */
import axios from 'axios';

export interface VillageIdentity {
  /** true: agen menyebut dirinya "asisten AI resmi, bukan petugas manusia". */
  disclosure: boolean;
  /** Nama persona, default "Gana". */
  personaName: string;
  /** Instruksi kepribadian tambahan dari admin desa (opsional). */
  personaDescription: string | null;
}

export const DEFAULT_IDENTITY: VillageIdentity = {
  disclosure: true,
  personaName: 'Gana',
  personaDescription: null,
};

const CACHE_TTL_MS = 60_000;
const cache = new Map<string, { at: number; value: VillageIdentity }>();

function normalize(raw: any): VillageIdentity {
  const ai = raw?.data?.ai_identity ?? raw?.ai_identity ?? {};
  const name = typeof ai.persona_name === 'string' && ai.persona_name.trim()
    ? ai.persona_name.trim().slice(0, 40)
    : DEFAULT_IDENTITY.personaName;
  const desc = typeof ai.persona_description === 'string' && ai.persona_description.trim()
    ? ai.persona_description.trim().slice(0, 500)
    : null;
  return {
    disclosure: ai.disclosure !== false,
    personaName: name,
    personaDescription: desc,
  };
}

export async function getVillageIdentity(villageId: string | undefined): Promise<VillageIdentity> {
  if (!villageId) return DEFAULT_IDENTITY;
  const hit = cache.get(villageId);
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.value;
  try {
    // Lazy: hindari side effect import-time (validateEnv) di static graph.
    const [{ config }, { default: logger }] = await Promise.all([
      import('../config/env'),
      import('../utils/logger'),
    ]);
    const res = await axios.get(
      `${config.dashboardServiceUrl}/api/internal/village-ai-identity`,
      {
        params: { village_id: villageId },
        headers: { 'x-internal-api-key': config.internalApiKey },
        timeout: 4000,
      },
    );
    const value = normalize(res.data);
    cache.set(villageId, { at: Date.now(), value });
    return value;
  } catch (err: any) {
    // Fail-open: dashboard tak terjangkau -> default transparan. Log best-effort.
    try {
      const { default: logger } = await import('../utils/logger');
      logger.warn('[village-identity] dashboard unreachable, fail-open to default', {
        villageId, error: err?.message ?? String(err),
      });
    } catch { /* abaikan */ }
    return DEFAULT_IDENTITY;
  }
}

/** Test hook: paksa nilai identity tanpa HTTP (dipakai unit test). */
export function __setCachedIdentity(villageId: string, value: VillageIdentity): void {
  cache.set(villageId, { at: Date.now(), value });
}

export function __clearIdentityCache(): void {
  cache.clear();
}
