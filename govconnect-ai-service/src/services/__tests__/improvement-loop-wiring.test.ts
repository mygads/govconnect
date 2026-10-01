/**
 * Improvement loop wiring — semua sumber failure tercatat.
 *
 * Memverifikasi wiring additive (fail-open) dari:
 *  (a) handoff ke manusia (staged-agent stage HANDOFF)
 *  (b) tool error (tool-executor catch)
 *  (c) user correction ("bukan itu maksud saya") — deteksi ringan di ingress v1/v2
 *  (d) LLM error / empty output (ai-gateway: semua attempt gagal)
 *
 * Strategi: prisma di-mock sehingga recordFailure() yang asli berjalan
 * (termasuk redactPii + fail-open) tanpa butuh DB. Integration test
 * memicu path asli runStagedTurn(HANDOFF) dan executeToolCall(throw).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Mocks ────────────────────────────────────────────────────────────────
// vi.hoisted: factory vi.mock di-hoist ke atas file, jadi mock fn harus
// dibuat via vi.hoisted agar tersedia saat factory dievaluasi.
const { mockExecuteRaw, mockQueryRaw } = vi.hoisted(() => ({
  mockExecuteRaw: vi.fn(async () => []),
  mockQueryRaw: vi.fn(async () => []),
}));

vi.mock('../../lib/prisma', () => ({
  default: { $executeRaw: mockExecuteRaw, $queryRaw: mockQueryRaw },
}));

vi.mock('../../utils/logger', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

// Integration (a): handoff via runStagedTurn — tiru pola w1-terminal-states.test.ts
vi.mock('../../gateway/tool-gateway', () => ({ gatewayExecute: vi.fn() }));
vi.mock('../ai-gateway.service', () => ({
  callAIGatewayPrompt: vi.fn(),
  classifyGatewayFailure: (e: string) => (/empty message content/i.test(e ?? '') ? 'empty_output' : 'error'),
}));
vi.mock('../../pipeline/pipeline-store', () => ({
  appendAudit: vi.fn(async () => true),
  idempotencyCheck: vi.fn(async () => ({ hit: false })),
  idempotencyStore: vi.fn(async () => undefined),
  loadTurnState: vi.fn(async () => null),
  saveTurnState: vi.fn(async () => true),
  clearTurnState: vi.fn(async () => undefined),
  getTakeover: vi.fn(async () => null),
  createFallbackTicket: vi.fn(async () => ({ ok: true, ticketId: 'TMP-TEST-001' })),
}));
vi.mock('../channel-client.service', () => ({
  startTakeoverForUser: vi.fn(async () => ({ ok: true })),
  updateConversationUserProfile: vi.fn(async () => undefined),
}));
// query-rewrite.service masih in-progress di worker lain; mock ini tidak
// aktif saat tidak ada import (aman dihapus bila sudah stabil).
vi.mock('../query-rewrite.service', () => ({
  buildQueryRewriteContext: vi.fn(() => ({ activeTopic: null, entities: [] })),
}));

// Integration (b): tool error — searchDocuments melempar
vi.mock('../knowledge.service', () => ({
  searchDocuments: vi.fn(async () => { throw new Error('db down'); }),
  searchKnowledge: vi.fn(async () => []),
  getVillageProfileSummary: vi.fn(async () => null),
}));

import {
  recordFailure,
  recordHandoffFailure,
  recordToolErrorFailure,
  recordGatewayFailure,
  maybeRecordUserCorrection,
  isUserCorrectionSignal,
  redactPii,
} from '../improvement-loop.service';
import { classifyGatewayFailure } from '../ai-gateway.service';
import { runStagedTurn, createPipelineContext } from '../../pipeline/staged-agent';
import { executeToolCall } from '../agent/tool-executor';

/** Tunggu fire-and-forget recordFailure() selesai. */
const flush = () => new Promise((r) => setTimeout(r, 30));

/** Ambil values dari INSERT INTO ai.conversation_failures. */
function insertedFailures(): Array<Record<string, unknown>> {
  const calls = mockExecuteRaw.mock.calls as unknown as Array<[TemplateStringsArray, ...unknown[]]>;
  return calls
    .filter(([strings]) => (strings?.[0] ?? '').includes('INSERT INTO ai.conversation_failures'))
    .map(([, ...values]) => ({
      // (id, village_id, session_id, user_message, failure_type, stage, intent)
      village_id: values[1],
      session_id: values[2],
      user_message: values[3],
      failure_type: values[4],
      stage: values[5],
      intent: values[6],
    }));
}

describe('improvement-loop wiring', () => {
  beforeEach(() => {
    mockExecuteRaw.mockClear();
    mockQueryRaw.mockClear();
    vi.clearAllMocks();
    // kembalikan default mockExecuteRaw setelah clearAllMocks
    mockExecuteRaw.mockImplementation(async () => []);
  });

  describe('(c) deteksi koreksi user — isUserCorrectionSignal', () => {
    it.each([
      'Bukan itu maksud saya, saya mau lapor jalan rusak',
      'maksud saya bukan itu',
      'bukan begitu cara kerjanya',
      'salah paham, saya tanya syarat KTP',
      'bukan jawaban itu yang saya mau',
      'salah, maksud saya KTP bukan KK',
      'bukan yang itu',
    ])('sinyal koreksi terdeteksi: "%s"', (msg) => {
      expect(isUserCorrectionSignal(msg)).toBe(true);
    });

    it.each([
      'halo, saya mau lapor jalan rusak',
      'bukan warga sini, saya dari desa sebelah',
      'berapa syarat bikin KTP?',
      '',
      'batalkan saja',
    ])('bukan sinyal koreksi: "%s"', (msg) => {
      expect(isUserCorrectionSignal(msg)).toBe(false);
    });
  });

  describe('(a) handoff → failure tercatat', () => {
    it('recordHandoffFailure mencatat failure_type=handoff, stage=HANDOFF', async () => {
      recordHandoffFailure({
        villageId: 'V-TEST', sessionId: 'S-1', message: 'minta petugas manusia dong',
      });
      await flush();
      const rows = insertedFailures();
      expect(rows).toHaveLength(1);
      expect(rows[0].failure_type).toBe('handoff');
      expect(rows[0].stage).toBe('HANDOFF');
      expect(rows[0].village_id).toBe('V-TEST');
      expect(rows[0].user_message).toContain('minta petugas manusia');
    });

    it('tidak mencatat bila villageId kosong atau recordable=false (shadow/eval)', async () => {
      recordHandoffFailure({ villageId: '', sessionId: 'S-1', message: 'x' });
      recordHandoffFailure({ villageId: 'V-TEST', sessionId: 'S-1', message: 'x', recordable: false });
      recordHandoffFailure({ sessionId: 'S-1', message: 'x' });
      await flush();
      expect(insertedFailures()).toHaveLength(0);
    });

    it('integration: runStagedTurn stage HANDOFF → failure tercatat + flow tidak rusak', async () => {
      const ctx = createPipelineContext({
        tenantId: 'V-HANDOFF', userId: 'web_test_handoff', channel: 'webchat', traceId: 'trace-handoff',
      });
      const res = await runStagedTurn({
        message: 'saya mau bicara dengan petugas',
        decision: { stage: 'HANDOFF', source: 'deterministic', confidence: 0.95, reasons: [] },
        ctx,
        villageName: 'Desa Test',
      } as any);
      await flush();
      // Flow utama tetap jalan: terminalState benar, ada respons
      expect(res.terminalState).toBe('WAITING_FOR_HUMAN');
      expect(res.response).toContain('petugas');
      // Failure tercatat
      const rows = insertedFailures().filter((r) => r.failure_type === 'handoff');
      expect(rows.length).toBeGreaterThanOrEqual(1);
      expect(rows[0].stage).toBe('HANDOFF');
      expect(rows[0].village_id).toBe('V-HANDOFF');
    });
  });

  describe('(b) tool error → failure tercatat', () => {
    it('recordToolErrorFailure mencatat failure_type=tool_error, stage=tool:<nama>', async () => {
      recordToolErrorFailure({
        villageId: 'V-TEST', sessionId: 'S-2', message: 'syarat ktp?',
        toolName: 'search_documents', errorCode: 'TOOL_EXECUTION_FAILED',
      });
      await flush();
      const rows = insertedFailures();
      expect(rows).toHaveLength(1);
      expect(rows[0].failure_type).toBe('tool_error');
      expect(rows[0].stage).toBe('tool:search_documents');
      expect(rows[0].intent).toBe('TOOL_EXECUTION_FAILED');
    });

    it('tidak mencatat di mode evaluation / knowledge_test', async () => {
      recordToolErrorFailure({
        villageId: 'V-TEST', sessionId: 'S-2', toolName: 'search_documents', recordable: false,
      });
      await flush();
      expect(insertedFailures()).toHaveLength(0);
    });

    it('integration: executeToolCall yang throw → failure tercatat + turn tidak crash', async () => {
      const result = await executeToolCall(
        'search_documents' as any,
        { query: 'syarat ktp' },
        {
          userId: 'u-1', villageId: 'V-TOOL', channel: 'webchat',
          traceId: 'trace-tool', userMessage: 'syarat bikin ktp apa saja?',
        } as any,
      );
      await flush();
      // Flow utama: exception di-mapping jadi failure result, tidak throw
      expect(result.result.success).toBe(false);
      expect(result.trace.success).toBe(false);
      expect(result.trace.sourceKind).toBe('tool_error');
      // Failure tercatat
      const rows = insertedFailures().filter((r) => r.failure_type === 'tool_error');
      expect(rows.length).toBeGreaterThanOrEqual(1);
      expect(rows[0].stage).toBe('tool:search_documents');
      expect(rows[0].village_id).toBe('V-TOOL');
      expect(rows[0].user_message).toContain('syarat bikin ktp');
    });
  });

  describe('(c) user correction → failure tercatat', () => {
    it('maybeRecordUserCorrection: sinyal koreksi → true + tercatat sebagai user_correction', async () => {
      const recorded = maybeRecordUserCorrection({
        villageId: 'V-TEST', sessionId: 'S-3',
        message: 'Bukan itu maksud saya, saya tanya syarat KTP',
      });
      expect(recorded).toBe(true);
      await flush();
      const rows = insertedFailures();
      expect(rows).toHaveLength(1);
      expect(rows[0].failure_type).toBe('user_correction');
      expect(rows[0].stage).toBe('INGRESS');
    });

    it('maybeRecordUserCorrection: pesan biasa → false + tidak tercatat', async () => {
      const recorded = maybeRecordUserCorrection({
        villageId: 'V-TEST', sessionId: 'S-3', message: 'berapa syarat bikin KTP?',
      });
      expect(recorded).toBe(false);
      await flush();
      expect(insertedFailures()).toHaveLength(0);
    });

    it('tidak mencatat bila recordable=false', async () => {
      const recorded = maybeRecordUserCorrection({
        villageId: 'V-TEST', sessionId: 'S-3',
        message: 'bukan itu maksud saya', recordable: false,
      });
      expect(recorded).toBe(false);
      await flush();
      expect(insertedFailures()).toHaveLength(0);
    });
  });

  describe('(d) LLM error → failure tercatat', () => {
    it('classifyGatewayFailure: bedakan empty_output vs error', () => {
      expect(classifyGatewayFailure('AI gateway returned empty message content')).toBe('empty_output');
      expect(classifyGatewayFailure('Empty message content dari model')).toBe('empty_output');
      expect(classifyGatewayFailure('provider timeout after 30000ms')).toBe('error');
      expect(classifyGatewayFailure('')).toBe('error');
    });

    it('recordGatewayFailure mencatat empty_output dengan stage gateway:<lane>', async () => {
      recordGatewayFailure({
        villageId: 'V-TEST', sessionId: 'S-4', message: 'syarat ktp?',
        failureType: 'empty_output', lane: 'llm',
      });
      await flush();
      const rows = insertedFailures();
      expect(rows).toHaveLength(1);
      expect(rows[0].failure_type).toBe('empty_output');
      expect(rows[0].stage).toBe('gateway:llm');
    });

    it('recordGatewayFailure mencatat error provider', async () => {
      recordGatewayFailure({
        villageId: 'V-TEST', sessionId: 'S-4', message: 'syarat ktp?',
        failureType: 'error', lane: 'llm',
      });
      await flush();
      const rows = insertedFailures();
      expect(rows).toHaveLength(1);
      expect(rows[0].failure_type).toBe('error');
    });
  });

  describe('fail-open + privacy', () => {
    it('PII di-redact sebelum disimpan (NIK, no HP, email)', async () => {
      recordHandoffFailure({
        villageId: 'V-TEST', sessionId: 'S-5',
        message: 'NIK saya 3273010101900001, hubungi 081234567890 atau budi@example.com ya',
      });
      await flush();
      const rows = insertedFailures();
      expect(rows).toHaveLength(1);
      const msg = String(rows[0].user_message);
      expect(msg).toContain('[NIK_REDACTED]');
      expect(msg).toContain('[PHONE_REDACTED]');
      expect(msg).toContain('[EMAIL_REDACTED]');
      expect(msg).not.toContain('3273010101900001');
      expect(msg).not.toContain('081234567890');
      expect(msg).not.toContain('budi@example.com');
    });

    it('redactPii: batas 500 char + pola PII', () => {
      expect(redactPii('a'.repeat(600))).toHaveLength(500);
      expect(redactPii('')).toBe('');
      expect(redactPii('NIK 3273010101900001')).toContain('[NIK_REDACTED]');
    });

    it('recording tidak pernah melempar walau DB down (fail-open)', async () => {
      mockExecuteRaw.mockRejectedValueOnce(new Error('connection refused'));
      // helper sync: tidak boleh throw
      expect(() =>
        recordToolErrorFailure({ villageId: 'V-TEST', toolName: 'x' }),
      ).not.toThrow();
      // recordFailure async: resolve, tidak reject
      mockExecuteRaw.mockRejectedValueOnce(new Error('connection refused'));
      await expect(
        recordFailure({
          village_id: 'V-TEST', session_id: 'S-6',
          user_message: 'halo', failure_type: 'error',
        }),
      ).resolves.toBeUndefined();
      await flush();
    });

    it('flow utama tetap jalan walau recording gagal', async () => {
      mockExecuteRaw.mockRejectedValue(new Error('db down'));
      const ctx = createPipelineContext({
        tenantId: 'V-FAILOPEN', userId: 'u-fail', channel: 'webchat', traceId: 'trace-failopen',
      });
      const res = await runStagedTurn({
        message: 'mau bicara petugas',
        decision: { stage: 'HANDOFF', source: 'deterministic', confidence: 0.95, reasons: [] },
        ctx,
        villageName: 'Desa Test',
      } as any);
      await flush();
      // Turn tetap selesai normal meski INSERT gagal
      expect(res.terminalState).toBe('WAITING_FOR_HUMAN');
      expect(res.response.length).toBeGreaterThan(0);
    });
  });
});
