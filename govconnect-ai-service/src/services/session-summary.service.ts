/**
 * Cross-Session Memory — auto-save wiring (session-end detector).
 *
 * `saveSessionSummary()` di last-interaction.service.ts sudah ada, tapi belum
 * ada yang memanggilnya: codebase tidak punya "session end" eksplisit.
 * Tidak ada socket disconnect (WA masuk via webhook/RabbitMQ, webchat via
 * REST stateless), tidak ada endpoint end-chat, dan tidak ada session manager
 * dengan expiry callback. Satu-satunya konsep session yang ada adalah
 * implisit: conversation-context LRU cache dengan TTL idle 30 menit.
 *
 * Pilihan desain (didokumentasikan, bukan hook yang sudah ada):
 *  - LAZY SESSION-BOUNDARY DETECTION. Setiap turn mencatat aktivitas
 *    (noteSessionTurn, dipanggil di akhir turn v1 & v2). Setiap turn baru
 *    memeriksa (checkSessionEnd, dipanggil di awal turn v1 & v2): bila turn
 *    terakhir lebih lama dari SESSION_IDLE_TIMEOUT_MS, session sebelumnya
 *    dianggap berakhir → ringkasannya di-save via saveSessionSummary().
 *  - Timeout 30 menit diselaraskan dengan TTL conversation-context
 *    (services/conversation-context.service.ts) agar "session" punya arti
 *    yang konsisten di seluruh service.
 *  - Ringkasan TIDAK pernah berisi transcript mentah: v1 memakai
 *    conversationSummary deterministik dari EnhancedContext (intent, state,
 *    nama field yang terkumpul, flag aksi selesai); v2 memakai ringkasan
 *    per-turn dari intent + tools + nomor tiket. PII di-redact oleh
 *    saveSessionSummary() (NIK → [NIK], HP → [HP], email → [email]).
 *  - Fail-open: semua fungsi di modul ini tidak pernah throw; kegagalan save
 *    tidak merusak alur pesan utama.
 *  - No double-save: satu session hanya di-finalize sekali, dijaga oleh
 *    finalized-set ber-key `${userKey}@${sessionStartTs}` + in-flight guard.
 *  - Tidak menulis saat isEvaluation / sideEffectMode != 'production'
 *    (shadow & knowledge_test tidak boleh mengotori memori produksi) —
 *    dijaga oleh caller.
 */

import logger from '../utils/logger';
import { saveSessionSummary } from './last-interaction.service';
import type { ProcessMessageResult } from './ump-types';

/** Idle timeout yang menandai session berakhir — selaras dengan TTL conversation-context. */
export const SESSION_IDLE_TIMEOUT_MS = 30 * 60 * 1000;

/** Nomor tiket GovConnect (LAP/TMP/SRV/REQ/LAY-YYYYMMDD-NNN). */
export const TICKET_REF_RE = /\b(?:LAP|TMP|SRV|REQ|LAY)-\d{4}\d{2}\d{2}-\d{2,6}\b/;

// Batas internal agar state in-memory tidak tumbuh tanpa batas.
const MAX_TRACKED_USERS = 2000;
const MAX_DIGEST_CHARS = 600;
const MAX_FINALIZED_KEYS = 5000;

interface TrackedSession {
  wa_user_id: string;
  village_id?: string;
  /** Timestamp turn pertama session ini (dipakai sebagai kunci dedup). */
  sessionStartTs: number;
  /** Timestamp turn terakhir yang tercatat. */
  lastActivityTs: number;
  /** Ringkasan session berjalan (deterministik, tanpa transcript mentah). */
  digest: string;
  turnCount: number;
  /** true bila session menghasilkan outcome konkret (tiket dibuat, aksi selesai). */
  hasOutcome: boolean;
}

const tracked = new Map<string, TrackedSession>();
/** Session yang sudah di-finalize: `${userKey}@${sessionStartTs}`. */
const finalized = new Set<string>();
/** Finalize yang sedang berjalan (async fire-and-forget) — cegah double-save konkuren. */
const inFlight = new Set<string>();

export interface SessionTurnNote {
  /** Identity per-channel (wa_user_id untuk WA, session_id untuk webchat). */
  userKey: string;
  wa_user_id: string;
  village_id?: string;
  /**
   * Ringkasan deterministik turn/session ini — TANPA transcript mentah.
   * Contoh v1: "Intent: COMPLAINT | State: COLLECTING | Data terkumpul: kategori".
   * Contoh v2: "Intent: STATUS_CHECK | Tiket: LAP-20261001-001".
   */
  summary?: string;
  /**
   * true = append ke digest (v2, ringkasan per-turn);
   * false = overwrite (v1, snapshot session-level dari EnhancedContext).
   */
  appendSummary?: boolean;
  hasOutcome?: boolean;
}

/**
 * Catat aktivitas turn. Dipanggil di AKHIR setiap turn (finally), fire-and-forget.
 * Tidak pernah throw.
 */
export function noteSessionTurn(note: SessionTurnNote): void {
  try {
    if (!note.userKey) return;
    const now = Date.now();
    let entry = tracked.get(note.userKey);
    if (!entry) {
      entry = {
        wa_user_id: note.wa_user_id,
        village_id: note.village_id,
        sessionStartTs: now,
        lastActivityTs: now,
        digest: '',
        turnCount: 0,
        hasOutcome: false,
      };
      // Bounded: hapus entry terlama bila melebihi kapasitas.
      if (tracked.size >= MAX_TRACKED_USERS) {
        const oldest = tracked.keys().next().value;
        if (oldest !== undefined) tracked.delete(oldest);
      }
      tracked.set(note.userKey, entry);
    }
    entry.lastActivityTs = now;
    entry.turnCount += 1;
    if (note.hasOutcome) entry.hasOutcome = true;

    const s = (note.summary ?? '').trim();
    if (s) {
      entry.digest = note.appendSummary
        ? `${entry.digest ? `${entry.digest} | ` : ''}${s}`.slice(-MAX_DIGEST_CHARS)
        : s.slice(0, MAX_DIGEST_CHARS);
    }
  } catch (err) {
    logger.debug('[session-summary] noteSessionTurn failed (non-fatal)', {
      error: String((err as Error)?.message ?? err).slice(0, 120),
    });
  }
}

/**
 * Deteksi session-end secara lazy. Dipanggil di AWAL setiap turn.
 * Bila turn terakhir user lebih lama dari SESSION_IDLE_TIMEOUT_MS, session
 * lama dianggap berakhir → ringkasannya di-save (async, fail-open, sekali saja),
 * lalu tracking di-reset untuk session baru.
 * Tidak pernah throw.
 */
export function checkSessionEnd(userKey: string): void {
  try {
    if (!userKey) return;
    const entry = tracked.get(userKey);
    const now = Date.now();
    if (!entry) {
      // Belum pernah tercatat — mulai tracking session baru.
      tracked.set(userKey, {
        wa_user_id: userKey,
        sessionStartTs: now,
        lastActivityTs: now,
        digest: '',
        turnCount: 0,
        hasOutcome: false,
      });
      return;
    }
    if (now - entry.lastActivityTs < SESSION_IDLE_TIMEOUT_MS) return;

    // Session lama berakhir. Finalize sekali saja (dedup via finalized-set).
    const finalizeKey = `${userKey}@${entry.sessionStartTs}`;
    const shouldSave =
      !finalized.has(finalizeKey) &&
      !inFlight.has(finalizeKey) &&
      isWorthSaving(entry);
    if (shouldSave) {
      inFlight.add(finalizeKey);
      void finalizeSession(userKey, entry, finalizeKey).catch(() => undefined);
    } else if (!finalized.has(finalizeKey) && !inFlight.has(finalizeKey)) {
      // Session trivial (tidak layak disimpan) — tetap tandai agar tidak dicek ulang.
      finalized.add(finalizeKey);
      boundSet(finalized, MAX_FINALIZED_KEYS);
    }

    // Reset untuk session baru; turn yang sedang berjalan akan mencatat via noteSessionTurn.
    tracked.set(userKey, {
      wa_user_id: entry.wa_user_id,
      village_id: entry.village_id,
      sessionStartTs: now,
      lastActivityTs: now,
      digest: '',
      turnCount: 0,
      hasOutcome: false,
    });
  } catch (err) {
    logger.debug('[session-summary] checkSessionEnd failed (non-fatal)', {
      error: String((err as Error)?.message ?? err).slice(0, 120),
    });
  }
}

/**
 * Finalize eksplisit — untuk sinyal session-end eksplisit di masa depan
 * (mis. tombol "akhiri chat" di webchat). Mengabaikan idle timeout.
 * Tidak pernah throw.
 */
export function endSessionNow(userKey: string): void {
  try {
    const entry = tracked.get(userKey);
    if (!entry) return;
    const finalizeKey = `${userKey}@${entry.sessionStartTs}`;
    if (finalized.has(finalizeKey) || inFlight.has(finalizeKey)) return;
    if (!isWorthSaving(entry)) {
      finalized.add(finalizeKey);
      boundSet(finalized, MAX_FINALIZED_KEYS);
      tracked.delete(userKey);
      return;
    }
    inFlight.add(finalizeKey);
    void finalizeSession(userKey, entry, finalizeKey).catch(() => undefined);
    tracked.delete(userKey);
  } catch (err) {
    logger.debug('[session-summary] endSessionNow failed (non-fatal)', {
      error: String((err as Error)?.message ?? err).slice(0, 120),
    });
  }
}

/** Session layak disimpan: punya ringkasan non-kosong dan bukan sekadar sapa 1 turn. */
function isWorthSaving(entry: TrackedSession): boolean {
  if (!entry.digest.trim()) return false;
  if (entry.turnCount < 2 && !entry.hasOutcome) return false;
  return true;
}

async function finalizeSession(
  userKey: string,
  entry: TrackedSession,
  finalizeKey: string,
): Promise<void> {
  try {
    await saveSessionSummary({
      wa_user_id: entry.wa_user_id,
      village_id: entry.village_id,
      summary: entry.digest,
      memory_type: 'session_summary',
      memory_key: `session_end_${entry.wa_user_id}_${entry.sessionStartTs}`,
    });
  } catch (err) {
    // saveSessionSummary sendiri tidak pernah throw; ini sabuk pengaman kedua.
    logger.debug('[session-summary] finalizeSession save failed (non-fatal)', {
      userKey: userKey.slice(0, 8) + '...',
      error: String((err as Error)?.message ?? err).slice(0, 120),
    });
  } finally {
    finalized.add(finalizeKey);
    boundSet(finalized, MAX_FINALIZED_KEYS);
    inFlight.delete(finalizeKey);
  }
}

function boundSet(set: Set<string>, max: number): void {
  while (set.size > max) {
    const oldest = set.values().next().value;
    if (oldest === undefined) break;
    set.delete(oldest);
  }
}

/**
 * Bangun ringkasan per-turn deterministik dari hasil turn (dipakai jalur v2
 * yang tidak memelihara EnhancedContext). Tidak memakai transcript mentah.
 */
export function summarizeTurnForSession(result: ProcessMessageResult): string {
  const parts: string[] = [];
  const intent = (result.intent ?? '').trim();
  if (intent && !['GREETING', 'ERROR', 'SPAM'].includes(intent)) {
    parts.push(`Intent: ${intent}`);
  }
  const tools = result.metadata?.toolsUsed ?? [];
  const interesting = tools.filter((t) =>
    /^(create_|update_|cancel_|get_|search_)/.test(t),
  );
  if (interesting.length > 0) parts.push(`Tools: ${interesting.slice(0, 4).join(', ')}`);
  const tickets = Array.from(
    (result.response ?? '').matchAll(new RegExp(TICKET_REF_RE.source, 'g')),
  ).map((m) => m[0]);
  const uniqueTickets = [...new Set(tickets)].slice(0, 3);
  if (uniqueTickets.length > 0) parts.push(`Tiket: ${uniqueTickets.join(', ')}`);
  return parts.join(' | ');
}

/** Test-only: reset state in-memory antar test. */
export function resetSessionSummaryStateForTests(): void {
  tracked.clear();
  finalized.clear();
  inFlight.clear();
}
