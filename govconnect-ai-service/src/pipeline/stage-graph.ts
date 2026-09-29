/**
 * Stage Graph — the executable SOP.
 *
 * Design (arsitektur-final §4):
 * - Stages are explicit; transitions are declared, not emergent.
 * - Administrative events & mutations are decided by CODE.
 * - The assessor (micro-LLM) only judges FUZZY transitions.
 *
 * Transition table: for each stage, a list of candidate next stages with
 * a `kind`: 'deterministic' (evaluated by pure functions, no LLM) or
 * 'fuzzy' (needs the assessor).
 */

import type { Stage } from './stage-types';

export type TransitionKind = 'deterministic' | 'fuzzy';

export interface StageTransition {
  from: Stage;
  to: Stage;
  kind: TransitionKind;
  /** Human-readable SOP rule, e.g. "semua slot wajib terisi → VERIFY". */
  rule: string;
}

/**
 * The full transition table. Keep it small and auditable — every row is a
 * product decision that can be reviewed without reading code.
 */
export const STAGE_TRANSITIONS: StageTransition[] = [
  // ── Main flow ──────────────────────────────────────────────
  { from: 'INGRESS', to: 'TRIAGE', kind: 'deterministic', rule: 'pesan baru selalu mulai dari triage' },
  { from: 'INGRESS', to: 'EMERGENCY', kind: 'deterministic', rule: 'kata kunci darurat → bypass langsung' },
  { from: 'INGRESS', to: 'INFORMATION', kind: 'deterministic', rule: 'pola tanya-info eksplisit (jam, syarat, biaya) → jalur cepat' },
  { from: 'INGRESS', to: 'STATUS_CHECK', kind: 'deterministic', rule: 'pola cek-status eksplisit → jalur cepat' },

  { from: 'TRIAGE', to: 'COLLECT', kind: 'fuzzy', rule: 'assessor: ini pengaduan/permohonan → kumpulkan data' },
  { from: 'TRIAGE', to: 'INFORMATION', kind: 'fuzzy', rule: 'assessor: ini pertanyaan informasi, bukan aksi' },
  { from: 'TRIAGE', to: 'STATUS_CHECK', kind: 'fuzzy', rule: 'assessor: ini cek status tiket' },
  { from: 'TRIAGE', to: 'HANDOFF', kind: 'fuzzy', rule: 'assessor: butuh manusia (frustrasi + blocker, topik sensitif)' },

  { from: 'COLLECT', to: 'VERIFY', kind: 'deterministic', rule: 'semua slot wajib terisi → verifikasi' },
  { from: 'COLLECT', to: 'COLLECT', kind: 'deterministic', rule: 'slot kurang → minta lagi (maks 2x, lalu handoff)' },
  { from: 'COLLECT', to: 'HANDOFF', kind: 'deterministic', rule: '2x gagal kumpulkan slot → handoff' },

  { from: 'VERIFY', to: 'EXECUTE', kind: 'deterministic', rule: 'konfirmasi eksplisit via tombol → eksekusi' },
  { from: 'VERIFY', to: 'COLLECT', kind: 'deterministic', rule: 'warga pilih "ubah" → kembali kumpulkan' },
  { from: 'VERIFY', to: 'CLOSE', kind: 'deterministic', rule: 'warga batalkan → tutup' },

  { from: 'EXECUTE', to: 'CLOSE', kind: 'deterministic', rule: 'eksekusi sukses → tutup + ringkasan' },
  { from: 'EXECUTE', to: 'HANDOFF', kind: 'deterministic', rule: 'eksekusi gagal permanen 2x → handoff' },

  // ── Fast lanes: deterministic, no assessor, no agent loop ──
  { from: 'INFORMATION', to: 'CLOSE', kind: 'deterministic', rule: 'jawab dari DB/RAG → tutup' },
  { from: 'STATUS_CHECK', to: 'CLOSE', kind: 'deterministic', rule: 'jawab dari DB → tutup' },
  { from: 'EMERGENCY', to: 'CLOSE', kind: 'deterministic', rule: 'kirim kontak darurat + eskalasi → tutup' },
  { from: 'HANDOFF', to: 'CLOSE', kind: 'deterministic', rule: 'serah terima tercatat → tutup turn' },
  { from: 'CLOSE', to: 'INGRESS', kind: 'deterministic', rule: 'turn selesai' },
];

/** Stages that must NEVER invoke the LLM agent loop (pure deterministic). */
export const DETERMINISTIC_ONLY_STAGES: ReadonlySet<Stage> = new Set([
  'INGRESS',
  'EMERGENCY',
  'STATUS_CHECK',
]);

/** Stages where mutations may happen — only via the deterministic stage-runner. */
export const MUTATION_STAGES: ReadonlySet<Stage> = new Set(['EXECUTE']);

/** Get candidate transitions out of a stage. */
export function transitionsFrom(stage: Stage): StageTransition[] {
  return STAGE_TRANSITIONS.filter((t) => t.from === stage);
}

/** Validate that a transition exists in the SOP graph. */
export function isAllowedTransition(from: Stage, to: Stage): boolean {
  return STAGE_TRANSITIONS.some((t) => t.from === from && t.to === to);
}
