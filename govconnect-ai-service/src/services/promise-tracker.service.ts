/**
 * Promise tracker.
 *
 * Detects agent-side promises ("saya cek", "akan diteruskan ke petugas",
 * "saya simpan dulu") in outgoing replies and surfaces them on the next
 * turn so the agent can follow up instead of dropping the thread.
 *
 * This is intentionally in-memory + short TTL. The goal is conversational
 * continuity within a session, not a persistent audit log. For durable
 * commitments we rely on the actual tool records (complaint IDs, service
 * links) stored in case-service.
 */

import { LRUCache } from '../utils/lru-cache';
import logger from '../utils/logger';

export type PromiseKind =
  | 'will_check'        // "saya cek dulu", "saya bantu cek"
  | 'will_forward'      // "saya teruskan ke petugas"
  | 'will_process'      // "segera kami proses"
  | 'will_remember'     // "saya catat ya"
  | 'will_confirm_later'; // "mohon tunggu sebentar"

export interface OpenPromise {
  kind: PromiseKind;
  summary: string;
  createdAt: number;
  turnId?: string;
}

// TTL aligns with a reasonable conversational window. Longer than the
// 10-minute ump-state TTL because promises outlive quick state flips,
// but short enough to avoid stale reminders in day-long sessions.
const PROMISE_TTL_MS = Math.max(
  5 * 60 * 1000,
  Number(process.env.PROMISE_TRACKER_TTL_MS || 30 * 60 * 1000),
);

const promiseStore = new LRUCache<string, OpenPromise[]>({
  maxSize: 2000,
  ttlMs: PROMISE_TTL_MS,
  name: 'promise-tracker',
});

function key(userId: string, villageId?: string): string {
  return `${villageId || '_default'}:${userId}`;
}

interface PromisePattern {
  kind: PromiseKind;
  regex: RegExp;
  makeSummary: (match: string) => string;
}

const PROMISE_PATTERNS: PromisePattern[] = [
  {
    kind: 'will_check',
    regex: /\b(saya\s+(?:bantu\s+)?cek(?:\s+dulu)?|biar\s+saya\s+cek|nanti\s+saya\s+cek)\b/i,
    makeSummary: () => 'akan mengecek informasi yang diminta',
  },
  {
    kind: 'will_forward',
    regex: /\b(saya\s+teruskan|akan\s+diteruskan|saya\s+sampaikan\s+ke\s+petugas|diteruskan\s+ke\s+petugas)\b/i,
    makeSummary: () => 'akan meneruskan ke petugas desa',
  },
  {
    kind: 'will_process',
    regex: /\b(segera\s+(?:kami\s+)?proses|akan\s+(?:kami\s+)?proses|kami\s+proses\s+ya)\b/i,
    makeSummary: () => 'akan memproses permintaan',
  },
  {
    kind: 'will_remember',
    regex: /\b(saya\s+catat(?:\s+dulu)?|sudah\s+saya\s+catat|kami\s+catat\s+dulu)\b/i,
    makeSummary: () => 'mencatat detail yang disampaikan user',
  },
  {
    kind: 'will_confirm_later',
    regex: /\b(mohon\s+(?:ditunggu|tunggu)(?:\s+sebentar)?|tunggu\s+sebentar\s+ya|sebentar\s+ya\s+pak|sebentar\s+ya\s+bu)\b/i,
    makeSummary: () => 'meminta user menunggu konfirmasi balasan',
  },
];

/**
 * Scan the outgoing reply for promise-shaped phrases and add them
 * to the user's open-promise list. Called after a turn is finalized.
 */
export function extractAndRecordPromises(
  userId: string,
  replyText: string,
  opts: { villageId?: string; turnId?: string } = {},
): OpenPromise[] {
  if (!userId || !replyText) return [];

  const now = Date.now();
  const newPromises: OpenPromise[] = [];

  for (const pattern of PROMISE_PATTERNS) {
    const match = replyText.match(pattern.regex);
    if (!match) continue;
    newPromises.push({
      kind: pattern.kind,
      summary: pattern.makeSummary(match[0]),
      createdAt: now,
      turnId: opts.turnId,
    });
  }

  if (newPromises.length === 0) return [];

  const k = key(userId, opts.villageId);
  const existing = promiseStore.get(k) || [];

  // De-dup by kind within 2-minute window to prevent stacking.
  const recentCutoff = now - 2 * 60 * 1000;
  const filteredExisting = existing.filter((p) => {
    const stillRecent = p.createdAt >= recentCutoff;
    return !(stillRecent && newPromises.some((n) => n.kind === p.kind));
  });

  const merged = [...filteredExisting, ...newPromises].slice(-5); // cap per user
  promiseStore.set(k, merged);

  logger.debug('[PromiseTracker] Recorded promise(s)', {
    userId,
    count: newPromises.length,
    kinds: newPromises.map((p) => p.kind),
  });

  return newPromises;
}

/**
 * List open promises that have not yet been resolved.
 */
export function listOpenPromises(
  userId: string,
  villageId?: string,
): OpenPromise[] {
  if (!userId) return [];
  return promiseStore.get(key(userId, villageId)) || [];
}

/**
 * Clear open promises — called when a tool has demonstrably fulfilled
 * the promise (e.g., after successful create_complaint or check_status).
 */
export function clearOpenPromises(userId: string, villageId?: string): void {
  if (!userId) return;
  promiseStore.delete(key(userId, villageId));
}

/**
 * Clear specific promise kinds. Useful when only one part of a promise
 * cluster has been fulfilled.
 */
export function resolvePromisesByKind(
  userId: string,
  kinds: PromiseKind[],
  villageId?: string,
): void {
  if (!userId || kinds.length === 0) return;
  const k = key(userId, villageId);
  const existing = promiseStore.get(k);
  if (!existing || existing.length === 0) return;
  const remaining = existing.filter((p) => !kinds.includes(p.kind));
  if (remaining.length === existing.length) return;
  if (remaining.length === 0) promiseStore.delete(k);
  else promiseStore.set(k, remaining);
}

/**
 * Build a short context line for the agent's dynamic context message,
 * reminding it what it previously promised. Returns empty string when
 * nothing is pending.
 */
function isPromiseFollowUpTurn(message?: string): boolean {
  const normalized = (message || '').toLowerCase().trim();
  if (!normalized) return true;

  return [
    /^(iya|ya|ok|oke|siap|lanjut|teruskan|jadi|gimana|bagaimana|mana|kok|loh|lho|belum|masih)[\s?.!]*$/i,
    /\b(jadi\s+gimana|gimana\s+lanjutannya|bagaimana\s+lanjutannya|ada\s+update|update(?:nya)?|sudah\s+dicek|sudah\s+diteruskan|katanya\s+tadi|kok\s+belum|mana\s+lanjutannya|statusnya\s+gimana)\b/i,
    /\b(cek|status|lanjut|proses|tindak\s+lanjut|follow\s*up|update)\b/i,
  ].some((pattern) => pattern.test(normalized));
}

export function buildOpenPromisesContext(
  userId: string,
  villageId?: string,
  currentMessage?: string,
): string {
  const open = listOpenPromises(userId, villageId);
  if (open.length === 0) return '';
  if (currentMessage && !isPromiseFollowUpTurn(currentMessage)) return '';

  const items = open
    .slice(-3)
    .map((p, idx) => `${idx + 1}. ${p.summary}`)
    .join('; ');
  return `Ada janji tindak lanjut yang masih terbuka: ${items}. Jika user sedang menagih kelanjutan, beri update yang konkret dan jujur; jangan mengulang janji tanpa progres.`;
}

/**
 * Heuristic: deduce which promise kinds a successful tool execution
 * fulfills. Keeps promise list realistic over long conversations.
 */
export function deriveFulfilledPromisesFromTools(toolsUsed: string[]): PromiseKind[] {
  const kinds = new Set<PromiseKind>();
  if (!toolsUsed?.length) return [];
  for (const tool of toolsUsed) {
    if (tool === 'create_complaint' || tool === 'create_service_request') {
      kinds.add('will_process');
      kinds.add('will_remember');
      // Creating a complaint with send_important_contacts / notifying
      // staff path effectively forwards the issue, so resolve that too.
      kinds.add('will_forward');
    }
    if (tool === 'check_status' || tool === 'get_my_history') kinds.add('will_check');
    if (tool === 'get_village_profile' || tool === 'get_service_info'
      || tool === 'get_important_contact' || tool === 'get_emergency_contacts'
      || tool === 'search_knowledge' || tool === 'search_documents') {
      kinds.add('will_check');
    }
  }
  return Array.from(kinds);
}

/**
 * Resolve a "will_forward" promise when the session is handed off to a
 * human operator. Called from UMP when takeover starts so the agent
 * doesn't keep reminding itself that it promised to forward.
 */
export function resolveForwardPromiseOnTakeover(
  userId: string,
  villageId?: string,
): void {
  resolvePromisesByKind(userId, ['will_forward', 'will_confirm_later'], villageId);
}

/** Test-only helper. Reset the in-memory store between tests. */
export function _resetPromiseStoreForTests(): void {
  promiseStore.clear();
}
