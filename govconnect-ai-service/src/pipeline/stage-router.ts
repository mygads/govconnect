/**
 * Stage Router - full-LLM routing (no regex fast-lanes).
 *
 * Design change (2026-10-01, user decision):
 * - Removed all regex patterns (EMERGENCY_PATTERNS, GREETING_PATTERNS, etc.)
 * - Regex made the agent dumber - blind pattern matching without context
 *   caused bugs (P0-2, P1-8).
 * - Now: every message -> TRIAGE -> LLM assessor decides the stage.
 * - The assessor is smarter, adaptive, and context-aware (like Hermes/OpenClaw).
 */

import type { StageDecision } from './stage-types';

export interface RouterInput {
  message: string;
  previousStage?: string;
}

function normalize(text: string): string {
  return text.trim().toLowerCase().replace(/\s+/g, ' ');
}

export function routeMessage(input: RouterInput): StageDecision {
  const text = normalize(input.message);

  if (!text) {
    return {
      stage: 'TRIAGE',
      source: 'deterministic',
      confidence: 1,
      reasons: ['empty_message'],
      hints: { needsAssessor: true },
    };
  }

  return {
    stage: 'TRIAGE',
    source: 'deterministic',
    confidence: 1,
    reasons: ['full_llm_routing'],
    hints: { needsAssessor: true },
  };
}
