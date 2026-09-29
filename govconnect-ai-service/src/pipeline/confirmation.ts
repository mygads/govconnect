/**
 * Confirmation binding — deterministic G2/G3 confirmation chain (P0-1).
 *
 * The ONLY way a mutation (G2/G3) may execute is a `confirm_send` button
 * click whose id is bound to the exact pending mutation minted by the VERIFY
 * stage in turn state. This binds the confirmation to ONE specific mutation
 * and rejects stale/replayed clicks (the pending mutation is single-use:
 * cleared right after the EXECUTE stage runs).
 *
 * Rules:
 * - `button.id` is authoritative. It travels channel-service → ai-service
 *   (see webhook.controller.ts `extractInteractiveResponseId`).
 * - Typed text ("Ya", "✅ Benar, kirim", ...) NEVER sets `confirmed` — it
 *   re-enters VERIFY so the citizen sees the confirm buttons again.
 * - `confirmed` on ProcessMessageInput / StagedAgentInput may ONLY be set by
 *   `bindConfirmation` below. No other caller may set it.
 *
 * Pure module: no DB, no network, no timers — safe to unit test.
 */

import { isExplicitConfirmation } from './slot-fsm';

/**
 * Button ids minted by wa-interactive confirmButtons().
 * Contract with channel-service: these ids MUST be forwarded as `button_id`.
 */
export const CONFIRM_BUTTON_IDS = ['confirm_send', 'edit_data', 'cancel_request'] as const;
export type ConfirmButtonId = (typeof CONFIRM_BUTTON_IDS)[number];

export function isKnownConfirmButton(buttonId: string | undefined | null): buttonId is ConfirmButtonId {
  return buttonId === 'confirm_send' || buttonId === 'edit_data' || buttonId === 'cancel_request';
}

/** A mutation minted deterministically by buildPendingMutation (slot-fsm). */
export interface PendingMutation {
  tool: string;
  args: Record<string, unknown>;
}

export function isPendingMutation(v: unknown): v is PendingMutation {
  if (!v || typeof v !== 'object') return false;
  const m = v as { tool?: unknown; args?: unknown };
  return typeof m.tool === 'string' && m.tool.length > 0 &&
    typeof m.args === 'object' && m.args !== null;
}

/**
 * Bind a button click to the pending mutation in turn state.
 *
 * Returns true ONLY when:
 *   1. buttonId === 'confirm_send', AND
 *   2. slots.pendingTool is a well-formed PendingMutation.
 *
 * Everything else (other buttons, missing/ malformed pendingTool, text)
 * returns false. Callers must treat false as "not confirmed".
 */
export function bindConfirmation(
  buttonId: string | undefined | null,
  slots: Record<string, unknown> | undefined | null,
): boolean {
  if (buttonId !== 'confirm_send') return false;
  return isPendingMutation(slots?.pendingTool);
}

export type ConfirmationResolution =
  | { kind: 'execute' }   // confirm_send + bound pending mutation → EXECUTE
  | { kind: 'stale' }     // known confirm button but no pending mutation → reject
  | { kind: 'edit' }      // edit_data + pending → deterministic correction reply
  | { kind: 'cancel' }    // cancel_request → deterministic cancellation reply
  | { kind: 'reverify' }  // affirmative text + pending, not button-bound → re-show VERIFY
  | { kind: 'route' };    // normal routing

/**
 * Decide what a turn means for the confirmation chain, deterministically.
 *
 * `confirmed` must be the output of bindConfirmation (orchestrator-bound).
 * process-message-v2 re-validates with its own turn-state load, so a forged
 * `confirmed: true` without a matching pendingTool can never reach EXECUTE.
 */
export function resolveConfirmation(input: {
  buttonId?: string | null;
  confirmed?: boolean;
  message: string;
  pending: PendingMutation | null;
  /** Channel of the turn. Webchat has no interactive buttons, so explicit
   *  text confirmation executes directly instead of re-showing buttons. */
  channel?: 'whatsapp' | 'webchat';
}): ConfirmationResolution {
  const btn = input.buttonId ?? null;

  if (btn === 'confirm_send') {
    // Bound click → EXECUTE. Anything else (stale click, no pending mutation,
    // forged confirmed flag) → rejected with a deterministic reply.
    if (input.confirmed === true && input.pending) return { kind: 'execute' };
    return { kind: 'stale' };
  }
  if (btn === 'edit_data') {
    return input.pending ? { kind: 'edit' } : { kind: 'stale' };
  }
  if (btn === 'cancel_request') {
    return { kind: 'cancel' };
  }
  // Affirmative TEXT ("Ya"):
  // - WhatsApp: never executes — re-enter VERIFY so the citizen gets the
  //   confirm buttons again (button.id is authoritative).
  // - Webchat: no buttons exist, so explicit text confirmation executes.
  if (input.pending && !input.confirmed && isExplicitConfirmation(input.message)) {
    if (input.channel === 'webchat') return { kind: 'execute' };
    return { kind: 'reverify' };
  }
  return { kind: 'route' };
}

/** Deterministic user-facing copies for the confirmation chain. */
export const STALE_CONFIRMATION_COPY =
  'Sesi konfirmasi ini sudah tidak berlaku — mungkin sudah diproses atau kedaluwarsa. ' +
  'Jika Anda ingin membuat laporan atau permohonan baru, silakan kirim pesan baru.';

export const CONFIRM_EDIT_COPY =
  'Baik, bagian mana yang ingin diperbaiki? Sebutkan saja, misalnya lokasinya atau deskripsinya.';

export const CONFIRM_CANCEL_COPY =
  'Baik, proses dibatalkan. Tidak ada data yang disimpan. Ada lagi yang bisa saya bantu?';
