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
  { from: 'TRIAGE', to: 'EMERGENCY', kind: 'fuzzy', rule: 'assessor: darurat nyata' },

  { from: 'COLLECT', to: 'VERIFY', kind: 'deterministic', rule: 'semua slot wajib terisi → verifikasi' },
  { from: 'COLLECT', to: 'COLLECT', kind: 'deterministic', rule: 'slot kurang → minta lagi (maks 2x, lalu handoff)' },
  { from: 'COLLECT', to: 'HANDOFF', kind: 'deterministic', rule: '2x gagal kumpulkan slot → handoff' },

  { from: 'VERIFY', to: 'EXECUTE', kind: 'deterministic', rule: 'konfirmasi eksplisit via tombol → eksekusi' },
  { from: 'VERIFY', to: 'COLLECT', kind: 'deterministic', rule: 'warga pilih "ubah" → kembali kumpulkan' },
  { from: 'VERIFY', to: 'CLOSE', kind: 'deterministic', rule: 'warga batalkan → tutup' },
  // P1-11: VERIFY terinterupsi pesan non-konfirmasi (mis. "kapan selesainya?").
  // Assessor menilai apakah warga bertanya tentang item yang diverifikasi
  // (tetap VERIFY, jawab dengan konteks pending mutation) atau jelas memulai
  // topik baru (TRIAGE → routing ulang). Tidak ada eksekusi di kedua jalur.
  { from: 'VERIFY', to: 'VERIFY', kind: 'fuzzy', rule: 'assessor: warga bertanya/menanggapi item yang diverifikasi → tetap VERIFY, jawab dengan konteks' },
  { from: 'VERIFY', to: 'TRIAGE', kind: 'fuzzy', rule: 'assessor: warga jelas memulai topik/permintaan baru → routing ulang' },

  { from: 'EXECUTE', to: 'CLOSE', kind: 'deterministic', rule: 'eksekusi sukses → tutup + ringkasan' },
  { from: 'EXECUTE', to: 'HANDOFF', kind: 'deterministic', rule: 'eksekusi gagal permanen 2x → handoff' },

  // ── Fast lanes: deterministic, no assessor, no agent loop ──
  { from: 'INFORMATION', to: 'CLOSE', kind: 'deterministic', rule: 'jawab dari DB/RAG → tutup' },
  { from: 'STATUS_CHECK', to: 'CLOSE', kind: 'deterministic', rule: 'jawab dari DB → tutup' },
  { from: 'EMERGENCY', to: 'CLOSE', kind: 'deterministic', rule: 'kirim kontak darurat + eskalasi → tutup' },
  { from: 'HANDOFF', to: 'CLOSE', kind: 'deterministic', rule: 'serah terima tercatat → tutup turn' },
  { from: 'CLOSE', to: 'INGRESS', kind: 'deterministic', rule: 'turn selesai' },
];

/**
 * Stages that must NEVER invoke the LLM agent loop (pure deterministic).
 *
 * Wired as a fail-closed guard in runStagedTurn (staged-agent.ts): if one of
 * these stages ever reaches the bounded agent loop, the turn throws and the
 * turn-level catch produces the never-silent fallback instead of an
 * LLM-generated answer.
 *
 * Membership notes (corrected 2026-09-29; previously this set was a dead
 * declaration that did not match reality):
 * - EMERGENCY: dedicated deterministic handler (emergencyReply), no LLM.
 * - VERIFY / EXECUTE: deterministic confirmation gate + confirmed-mutation
 *   runner, no LLM loop.
 * - INGRESS is NOT listed: the stage router maps it deterministically to
 *   TRIAGE/EMERGENCY/INFORMATION/STATUS_CHECK, so it never reaches
 *   runStagedTurn as a decision stage.
 * - STATUS_CHECK is NOT listed: it intentionally uses the bounded agent loop
 *   with a DB-only tool allowlist (check_status, get_my_history) so citizens
 *   get a natural-language status answer; the data itself is deterministic.
 */
export const DETERMINISTIC_ONLY_STAGES: ReadonlySet<Stage> = new Set([
  'EMERGENCY',
  'VERIFY',
  'EXECUTE',
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
