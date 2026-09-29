/**
 * Tool Policy — declarative, auditable policy tables for the tool gateway.
 *
 * This module is PURE (no service imports) so policy can be unit-tested
 * and reviewed without dragging the execution dependency graph.
 *
 * - TOOL_GRADES: every tool has a guardrail grade (G0–G3).
 * - STAGE_TOOL_ALLOWLIST: every stage declares exactly which tools exist.
 *   No regex routing. If a tool isn't listed for the stage, the gateway
 *   blocks it — fail closed.
 */

import type { AgentToolName } from '../services/agent/tool-definitions';
import type { Stage, ToolGrade } from '../pipeline/stage-types';

/** Tool → grade. Mutations are G2/G3 and need deterministic confirmation. */
export const TOOL_GRADES: Record<AgentToolName, ToolGrade> = {
  get_village_profile: 'G0',
  get_service_info: 'G0',
  get_complaint_categories: 'G0',
  get_emergency_contacts: 'G0',
  get_important_contact: 'G0',
  search_knowledge: 'G0',
  search_documents: 'G0',
  load_skill: 'G0',
  search_user_memory: 'G1',
  get_my_history: 'G1',
  check_status: 'G1',
  get_service_request_edit_link: 'G2',
  create_complaint: 'G2',
  create_service_request: 'G2',
  update_complaint: 'G3',
  cancel_request: 'G3',
};

/** Stage → tools the stage is allowed to call. Declarative, auditable. */
export const STAGE_TOOL_ALLOWLIST: Record<Stage, ReadonlySet<AgentToolName>> = {
  INGRESS: new Set(),
  TRIAGE: new Set(['get_complaint_categories', 'get_village_profile', 'get_service_info']),
  COLLECT: new Set(['get_service_info', 'get_complaint_categories', 'search_knowledge', 'load_skill']),
  VERIFY: new Set(['get_service_info', 'search_user_memory']),
  EXECUTE: new Set(['create_complaint', 'create_service_request', 'update_complaint', 'cancel_request', 'get_service_request_edit_link']),
  CLOSE: new Set(),
  INFORMATION: new Set(['get_village_profile', 'get_service_info', 'get_important_contact', 'get_emergency_contacts', 'search_knowledge', 'search_documents', 'load_skill']),
  STATUS_CHECK: new Set(['check_status', 'get_my_history']),
  EMERGENCY: new Set(['get_emergency_contacts']),
  HANDOFF: new Set(),
};

/** Read-only G0 tools that are independent may run in parallel. */
export function isParallelizable(tool: AgentToolName): boolean {
  return TOOL_GRADES[tool] === 'G0';
}
