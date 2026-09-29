/**
 * Per-claim verifier — checks every factual claim in the final answer
 * against tool/DB evidence before the citizen sees it.
 *
 * Design (arsitektur-final §6, §8):
 * - The LLM is a storyteller, not a source of truth. Each factual claim
 *   (ticket refs, statuses, dates, amounts) must be grounded in evidence
 *   the pipeline actually retrieved this turn.
 * - Unsupported claims are replaced inline with a hedged marker — the
 *   answer still ships (never-silent) but never asserts unverified facts.
 * - Deterministic: pure regex extraction + substring evidence matching.
 */

export interface Claim {
  type: 'ticket_ref' | 'status' | 'date' | 'amount';
  value: string;
  /** Start index of the claim span in the original text. */
  index: number;
}

const TICKET_RE = /\b(?:LAP|TMP|SRV|ADU)-\d{4,8}(?:-[0-9A-Z]{3,})?\b/gi;
const STATUS_RE = /\b(?:diproses|diterima|disetujui|ditolak|selesai|dibatalkan|menunggu|dikerjakan)\b/gi;
const DATE_RE = /\b\d{1,2}[-/]\d{1,2}[-/]\d{2,4}\b/g;
const AMOUNT_RE = /\bRp\s?[\d.]{4,}\b/gi;

/** Extract factual claims from answer text. */
export function extractClaims(text: string): Claim[] {
  const claims: Claim[] = [];
  const push = (re: RegExp, type: Claim['type']) => {
    re.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = re.exec(text)) !== null) {
      claims.push({ type, value: m[0], index: m.index });
    }
  };
  push(TICKET_RE, 'ticket_ref');
  push(STATUS_RE, 'status');
  push(DATE_RE, 'date');
  push(AMOUNT_RE, 'amount');
  return claims.sort((a, b) => a.index - b.index);
}

/** Normalize for evidence matching (case/whitespace/punctuation tolerant). */
function norm(s: string): string {
  return s.toLowerCase().replace(/[\s._-]+/g, '');
}

/**
 * Verify claims against evidence texts (tool results + DB records).
 * Returns the corrected text and the list of unsupported claims.
 */
export function verifyClaims(
  text: string,
  evidence: string[],
): { text: string; unsupported: Claim[] } {
  const corpus = norm(evidence.join('\n'));
  const claims = extractClaims(text);
  const unsupported: Claim[] = [];
  // Replace from the end so earlier indexes stay valid.
  let out = text;
  const sorted = [...claims].sort((a, b) => b.index - a.index);
  for (const c of sorted) {
    const supported = corpus.includes(norm(c.value));
    if (!supported) {
      unsupported.push(c);
      const marker = c.type === 'ticket_ref'
        ? '[nomor referensi belum terverifikasi]'
        : c.type === 'status'
          ? '[status belum terverifikasi]'
          : '[belum terverifikasi]';
      out = out.slice(0, c.index) + marker + out.slice(c.index + c.value.length);
    }
  }
  unsupported.reverse();
  return { text: out, unsupported };
}

/**
 * Convenience: run verification and report. Pure apart from the logger.
 */
export function verifyAnswerClaims(
  text: string,
  evidence: string[],
): { text: string; unsupportedCount: number } {
  if (evidence.length === 0) {
    // No evidence this turn: any factual claim is suspicious. The caller
    // decides (fast lanes with DB reads always have evidence).
    return { text, unsupportedCount: 0 };
  }
  const { text: corrected, unsupported } = verifyClaims(text, evidence);
  return { text: corrected, unsupportedCount: unsupported.length };
}
