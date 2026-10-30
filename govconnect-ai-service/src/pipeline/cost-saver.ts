/**
 * cost-saver — W14: disiplin "1 pesan per turn" + flag WA_COST_SAVER_MODE.
 *
 * Arsitektur-final §6.3/§10: satu turn = satu pesan WhatsApp berbayar.
 * Pesan filler sudah dihapus (W13); yang tersisa adalah bubble kedua
 * "guidance" yang dikirim channel-service sebagai pesan terpisah.
 *
 * Mekanisme (deterministik, tanpa LLM):
 * - Flag: WA_COST_SAVER_MODE=true (env). Default false → perilaku lama.
 * - Saat flag on, guidance digabung ke teks balasan utama dengan pemisah
 *   "\n\n" — konten TIDAK PERNAH dibuang diam-diam, hanya digabung.
 * - v2 pipeline menggabung SEBELUM membangun interactive payload, sehingga
 *   body buttons/list ikut membawa guidance dan validasi batas WA tetap jalan.
 * - channel-service juga menegakkan di sisi kirim (untuk produsen v1):
 *   bubble guidance kedua dilewati total saat flag on.
 *
 * Batasan jujur: ini menghemat jumlah pesan, bukan meniadakan biaya —
 * pesan utility/template proaktif tetap berbayar sesuai ketentuan provider.
 */

export function isCostSaverMode(): boolean {
  return process.env.WA_COST_SAVER_MODE === 'true';
}

export interface CollapsedTurn {
  /** Single message text to send. */
  text: string;
  /** True when guidance was merged into the reply (audit it). */
  mergedGuidance: boolean;
}

/**
 * Deterministically collapse reply + guidance into exactly one message.
 * Pure function — safe to unit test without env/DB/network.
 */
export function collapseTurnMessages(
  replyText: string,
  guidanceText?: string | null,
): CollapsedTurn {
  const reply = (replyText ?? '').trim();
  const guidance = (guidanceText ?? '').trim();
  if (!guidance) return { text: reply, mergedGuidance: false };
  if (!reply) return { text: guidance, mergedGuidance: true };
  return { text: `${reply}\n\n${guidance}`, mergedGuidance: true };
}
