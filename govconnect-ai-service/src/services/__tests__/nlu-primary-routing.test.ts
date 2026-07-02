/**
 * Tests for NLU-primary routing in decideFastIntent.
 *
 * Verifies the adaptive behavior: a confident micro-NLU routing_intent leads,
 * regex is the safety net when NLU is null/low-confidence, and the emergency
 * override stays deterministic even when the classifier is unavailable.
 */

import { describe, it, expect, vi } from 'vitest';

vi.mock('axios', () => {
  const get = vi.fn();
  const post = vi.fn();
  return { default: { get, post }, get, post };
});

vi.mock('../case-client.service', () => ({
  getServiceCatalog: vi.fn(),
  getUserHistory: vi.fn().mockResolvedValue({ total: 0, combined: [], services: [] }),
  cancelComplaint: vi.fn(),
  cancelServiceRequest: vi.fn(),
}));

import { decideFastIntent } from '../pre-agent-state-router.service';
import type { UnifiedClassifyResult } from '../micro-llm-matcher.service';

function nlu(over: Partial<UnifiedClassifyResult>): UnifiedClassifyResult {
  return {
    message_type: 'QUESTION',
    rag_needed: true,
    categories: [],
    confidence: 0.8,
    ...over,
  };
}

describe('decideFastIntent — NLU-primary routing', () => {
  it('routes a colloquial service request via NLU when regex misses it', () => {
    // "badhe damel KK" (Javanese) — no regex service keyword matches, but NLU
    // understands the intent. This is the core adaptive win.
    const decision = decideFastIntent({
      message: 'badhe damel KK',
      unified: nlu({ routing_intent: 'service_info', routing_confidence: 0.85 }),
    });
    expect(decision.primaryIntent).toBe('service_info');
    expect(decision.reasons).toContain('nlu_service_info');
    expect(decision.allowedToolHints).toContain('get_service_info');
  });

  it('promotes confidence to hard when regex agrees with NLU', () => {
    // "bikin surat KTP" — SERVICE_ADMIN_PATTERN matches AND NLU says service_info.
    const decision = decideFastIntent({
      message: 'saya mau bikin surat KTP',
      unified: nlu({ routing_intent: 'service_info', routing_confidence: 0.9 }),
    });
    expect(decision.primaryIntent).toBe('service_info');
    expect(decision.confidence).toBe('hard');
  });

  it('falls back to regex routing when NLU is null (classifier down)', () => {
    // No unified result at all (LLM timeout). Regex complaint signal must still
    // route deterministically — no stall.
    const decision = decideFastIntent({
      message: 'jalan rusak parah depan masjid',
      unified: null,
    });
    expect(decision.primaryIntent).toBe('complaint_creation');
    expect(decision.reasons).toContain('complaint_signal');
  });

  it('keeps the emergency override deterministic even when NLU is null', () => {
    // Fire report with the classifier unavailable — must still route to
    // emergency via regex, never depend on the LLM.
    const decision = decideFastIntent({
      message: 'tolong ada kebakaran besar sekarang',
      unified: null,
    });
    expect(decision.primaryIntent).toBe('emergency_contact');
    expect(decision.reasons).toContain('emergency_signal');
  });

  it('ignores low-confidence NLU and falls through to regex/classifier fallback', () => {
    // routing_confidence below the 0.7 threshold — NLU is not trusted to lead.
    const decision = decideFastIntent({
      message: 'hmm sesuatu yang tidak jelas',
      unified: nlu({ routing_intent: 'service_info', routing_confidence: 0.4 }),
    });
    expect(decision.primaryIntent).not.toBe('service_info');
  });

  it('does not lead on NLU "unknown" intent', () => {
    const decision = decideFastIntent({
      message: 'nama saya Budi',
      unified: nlu({ message_type: 'DATA_INPUT', routing_intent: 'unknown', routing_confidence: 0.9 }),
    });
    // Should not commit to a specific intent from NLU; falls through.
    expect(decision.reasons).not.toContain('nlu_unknown');
  });

  it('defers (not hard_block) on NLU out_of_scope so agent can redirect politely', () => {
    const decision = decideFastIntent({
      message: 'tolong buatkan kode python untuk sorting',
      unified: nlu({ routing_intent: 'out_of_scope', routing_confidence: 0.85 }),
    });
    expect(decision.primaryIntent).toBe('out_of_scope');
    expect(decision.action).toBe('defer_to_agent');
  });

  it('routes contact_lookup via NLU for a phrasing regex would miss', () => {
    const decision = decideFastIntent({
      message: 'kepala desa bisa dihubungi lewat apa ya',
      unified: nlu({ routing_intent: 'contact_lookup', routing_confidence: 0.8 }),
    });
    expect(decision.primaryIntent).toBe('contact_lookup');
    expect(decision.allowedToolHints).toContain('get_important_contact');
  });

  it('pending-state machine still wins over NLU (state affinity preserved)', () => {
    // When a pending service offer is active and the user confirms, the
    // deterministic state handler must win — NLU should not hijack it.
    const decision = decideFastIntent({
      message: 'iya lanjut',
      hasPendingServiceOffer: true,
      unified: nlu({ routing_intent: 'knowledge_query', routing_confidence: 0.9 }),
    });
    expect(decision.stateAffinity).toBe('answers_pending_state');
  });
});
