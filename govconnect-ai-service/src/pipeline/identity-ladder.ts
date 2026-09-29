/**
 * Identity ladder L0–L2 (arsitektur-final §6, v5 threat model).
 *
 * - L0 — anonymous: public information only (village profile, services,
 *   emergency contacts, general knowledge).
 * - L1 — channel-authenticated sender: controls the WhatsApp account that
 *   sent the message. May read their OWN data (ticket status, history).
 * - L2 — identity verified by village staff: an administrative act
 *   (offline KTP check at the village office), recorded in
 *   pipeline_identity_verifications. May perform sensitive actions
 *   (file/update/cancel complaints and service requests).
 *
 * The ladder is DETERMINISTIC — never an LLM decision — and enforced in
 * the tool gateway (fail-closed). A WA number alone never implies NIK
 * ownership (v5: "nomor WA ≠ kepemilikan NIK").
 *
 * NOTE: there is no online Dukcapil verification API; this module does not
 * claim one. Verification is administrative, by perangkat desa.
 */

import type { AgentToolName } from '../services/agent/tool-definitions';
import { identityIsVerified, appendAudit } from './pipeline-store';
import logger from '../utils/logger';

export type IdentityLevel = 'L0' | 'L1' | 'L2';

const RANK: Record<IdentityLevel, number> = { L0: 0, L1: 1, L2: 2 };

/** Minimum identity level per tool. Pure table — auditable. */
export const TOOL_IDENTITY_MIN: Record<AgentToolName, IdentityLevel> = {
  // L0 — public information.
  get_village_profile: 'L0',
  get_service_info: 'L0',
  get_complaint_categories: 'L0',
  get_emergency_contacts: 'L0',
  get_important_contact: 'L0',
  search_knowledge: 'L0',
  search_documents: 'L0',
  load_skill: 'L0',
  // L1 — own data, channel-authenticated.
  search_user_memory: 'L1',
  get_my_history: 'L1',
  check_status: 'L1',
  get_service_request_edit_link: 'L1',
  // L2 — sensitive mutations, verified identity.
  create_complaint: 'L2',
  create_service_request: 'L2',
  update_complaint: 'L2',
  cancel_request: 'L2',
};

/** Pure check: may this identity level call this tool? */
export function meetsIdentityRequirement(
  tool: AgentToolName, level: IdentityLevel,
): boolean {
  const need = TOOL_IDENTITY_MIN[tool];
  if (!need) return false; // unknown tool → deny (fail-closed)
  return RANK[level] >= RANK[need];
}

/**
 * Resolve the caller's identity level. Deterministic:
 * L2 iff an active admin verification exists; else L1 iff the sender is a
 * channel-authenticated WhatsApp user; else L0.
 */
export async function resolveIdentityLevel(input: {
  tenantId: string; userId: string; channel: string;
}): Promise<IdentityLevel> {
  const { tenantId, userId, channel } = input;
  try {
    if (tenantId && userId && (await identityIsVerified(tenantId, userId))) {
      return 'L2';
    }
  } catch {
    // Verification store unavailable → fall through to L1/L0 (fail-safe:
    // availability preserved, sensitive tools stay blocked at L2).
    logger.debug('[identity-ladder] verification store unavailable');
  }
  if (channel === 'whatsapp' && userId) return 'L1';
  return 'L0';
}

/** User-facing copy when a tool is denied for identity reasons. */
export function identityDenialCopy(tool: AgentToolName): string {
  const need = TOOL_IDENTITY_MIN[tool] ?? 'L2';
  if (need === 'L1') {
    return 'Fitur ini membutuhkan nomor WhatsApp yang terhubung dengan akun pengirim. ' +
      'Silakan hubungi kami melalui WhatsApp resmi desa.';
  }
  return 'Untuk keamanan, tindakan ini memerlukan verifikasi identitas satu kali oleh perangkat desa. ' +
    'Silakan datang ke kantor desa dengan membawa KTP — setelah terverifikasi, saya bisa membantu.';
}

/** Audit helper for identity decisions (called by the orchestrator layer). */
export async function auditIdentityLevel(input: {
  tenantId: string; userId: string; channel: string; traceId: string; level: IdentityLevel;
}): Promise<void> {
  await appendAudit({
    tenantId: input.tenantId, traceId: input.traceId, userId: input.userId,
    channel: input.channel, stage: 'INGRESS', event: 'identity_level_resolved',
    payload: { level: input.level },
  }).catch(() => undefined);
}
