/**
 * session-summary.service tests — cross-session memory auto-save wiring.
 *
 * Memakai saveSessionSummary ASLI (redaksi PII riil) dengan prisma di-mock,
 * sehingga assertion "summary ter-redact" menguji path produksi yang sebenarnya.
 *
 * Covers:
 *  1. Session end (idle > SESSION_IDLE_TIMEOUT_MS) → save dipanggil SEKALI
 *     dengan summary ter-redact (NIK/HP/email), ≤200 char, tanpa transcript mentah.
 *  2. Double session-end detection → tidak double-save.
 *  3. save gagal (prisma reject) → flow utama tetap aman (fail-open).
 *  4. Session trivial (1 turn tanpa outcome, summary kosong) → tidak disimpan.
 *  5. Session baru setelah session lama berakhir → satu save per session,
 *     memory_key berbeda.
 *  6. checkSessionEnd dalam batas idle → tidak menyimpan apa-apa.
 *  7. endSessionNow → finalize eksplisit tanpa menunggu idle, idempotent.
 *  8. summarizeTurnForSession tidak memakai transcript mentah.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const T0 = new Date('2026-10-01T10:00:00+07:00');

// NOTE: vi.mock factories are hoisted — they must not reference top-level
// variables, so the prisma mock fn is created inside the factory and
// re-acquired below via the mocked module.
vi.mock('../../lib/prisma', () => ({
  default: { user_memory_entries: { create: vi.fn(async () => ({ id: 'mem-1' })) } },
}));

// hybrid-memory.service menarik dependency berat (embedding, observability);
// saveSessionSummary tidak memakainya, jadi mock agar import ringan.
vi.mock('../hybrid-memory.service', () => ({
  searchUserMemories: vi.fn(async () => []),
}));

import prisma from '../../lib/prisma';
import {
  checkSessionEnd,
  noteSessionTurn,
  endSessionNow,
  summarizeTurnForSession,
  SESSION_IDLE_TIMEOUT_MS,
  resetSessionSummaryStateForTests,
} from '../session-summary.service';
import type { ProcessMessageResult } from '../ump-types';

const mockedCreate = prisma.user_memory_entries.create as unknown as ReturnType<typeof vi.fn>;

function flushPromises(): Promise<void> {
  // Microtask-only flush — aman dipakai bersama vi.useFakeTimers().
  return new Promise((resolve) => process.nextTick(resolve));
}

function baseResult(overrides: Partial<ProcessMessageResult> = {}): ProcessMessageResult {
  return {
    success: true,
    response: 'ok',
    intent: 'QUESTION',
    ...overrides,
    metadata: {
      processingTimeMs: 10,
      hasKnowledge: false,
      ...(overrides.metadata ?? {}),
    },
  };
}

describe('session-summary auto-save', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(T0);
    resetSessionSummaryStateForTests();
    mockedCreate.mockClear();
    mockedCreate.mockImplementation(async () => ({ id: 'mem-1' }));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('menyimpan summary ter-redact sekali saat session end terdeteksi', async () => {
    const userKey = '6281111111111';

    // Session berjalan: 2 turn dengan summary mengandung PII mentah.
    noteSessionTurn({
      userKey,
      wa_user_id: userKey,
      village_id: 'village-1',
      summary: 'Intent: COMPLAINT | NIK 1234567890123456 lapor jalan rusak, hub 081234567890',
      appendSummary: true,
      hasOutcome: true,
    });
    noteSessionTurn({
      userKey,
      wa_user_id: userKey,
      village_id: 'village-1',
      summary: 'Intent: COMPLAINT | Tiket: LAP-20261001-001 dibuat, email warga a@b.co.id',
      appendSummary: true,
      hasOutcome: true,
    });
    expect(mockedCreate).not.toHaveBeenCalled();

    // Turn baru datang setelah idle 31 menit → session lama berakhir.
    vi.setSystemTime(new Date(T0.getTime() + 31 * 60 * 1000));
    checkSessionEnd(userKey);
    await flushPromises();
    await flushPromises();

    expect(mockedCreate).toHaveBeenCalledTimes(1);
    const data = mockedCreate.mock.calls[0][0].data;
    expect(data.wa_user_id).toBe(userKey);
    expect(data.village_id).toBe('village-1');
    expect(data.memory_type).toBe('session_summary');
    expect(data.memory_key).toMatch(/^session_end_6281111111111_\d+$/);
    // PII ter-redact oleh saveSessionSummary asli — bukan digit mentah.
    expect(data.content).toContain('[NIK]');
    expect(data.content).toContain('[HP]');
    expect(data.content).toContain('[email]');
    expect(data.content).not.toContain('1234567890123456');
    expect(data.content).not.toContain('081234567890');
    expect(data.content).not.toContain('a@b.co.id');
    // Bukan transcript mentah — ringkasan deterministik, ≤200 char.
    expect(data.content.length).toBeLessThanOrEqual(200);
  });

  it('double session-end tidak double-save', async () => {
    const userKey = '6282222222222';
    noteSessionTurn({
      userKey,
      wa_user_id: userKey,
      summary: 'Intent: STATUS_CHECK | Tiket: LAP-20261001-002',
      appendSummary: true,
      hasOutcome: true,
    });

    vi.setSystemTime(new Date(T0.getTime() + 31 * 60 * 1000));
    checkSessionEnd(userKey);
    checkSessionEnd(userKey); // deteksi berulang — harus tetap 1 save
    checkSessionEnd(userKey);
    await flushPromises();
    await flushPromises();

    expect(mockedCreate).toHaveBeenCalledTimes(1);
  });

  it('save gagal (DB error) → flow utama tetap aman (fail-open)', async () => {
    const userKey = '6283333333333';
    mockedCreate.mockRejectedValueOnce(new Error('db down'));
    noteSessionTurn({
      userKey,
      wa_user_id: userKey,
      summary: 'Intent: COMPLAINT | Tiket: LAP-20261001-003',
      appendSummary: true,
      hasOutcome: true,
    });

    vi.setSystemTime(new Date(T0.getTime() + 31 * 60 * 1000));
    // Tidak boleh throw — checkSessionEnd fail-open.
    expect(() => checkSessionEnd(userKey)).not.toThrow();
    await flushPromises();
    await flushPromises();

    expect(mockedCreate).toHaveBeenCalledTimes(1);
  });

  it('session trivial (1 turn tanpa outcome, summary kosong) tidak disimpan', async () => {
    const userKey = '6284444444444';
    noteSessionTurn({ userKey, wa_user_id: userKey, summary: '' });

    vi.setSystemTime(new Date(T0.getTime() + 31 * 60 * 1000));
    checkSessionEnd(userKey);
    await flushPromises();
    await flushPromises();

    expect(mockedCreate).not.toHaveBeenCalled();
  });

  it('session baru setelah session lama → satu save per session', async () => {
    const userKey = '6285555555555';

    // Session 1.
    noteSessionTurn({
      userKey, wa_user_id: userKey,
      summary: 'Intent: COMPLAINT | Tiket: LAP-20261001-004',
      appendSummary: true, hasOutcome: true,
    });
    vi.setSystemTime(new Date(T0.getTime() + 31 * 60 * 1000));
    checkSessionEnd(userKey);
    await flushPromises();
    await flushPromises();
    expect(mockedCreate).toHaveBeenCalledTimes(1);
    const key1 = mockedCreate.mock.calls[0][0].data.memory_key;

    // Session 2: turn baru (checkSessionEnd sudah reset tracking), lalu idle lagi.
    noteSessionTurn({
      userKey, wa_user_id: userKey,
      summary: 'Intent: QUESTION | Tools: search_kb', appendSummary: true,
    });
    noteSessionTurn({
      userKey, wa_user_id: userKey,
      summary: 'Intent: QUESTION | Tools: search_kb', appendSummary: true,
    });
    vi.setSystemTime(new Date(T0.getTime() + 65 * 60 * 1000));
    checkSessionEnd(userKey);
    await flushPromises();
    await flushPromises();

    expect(mockedCreate).toHaveBeenCalledTimes(2);
    const key2 = mockedCreate.mock.calls[1][0].data.memory_key;
    expect(key2).not.toBe(key1);
  });

  it('endSessionNow memfinalize eksplisit tanpa menunggu idle, idempotent', async () => {
    const userKey = '6286666666666';
    noteSessionTurn({
      userKey, wa_user_id: userKey,
      summary: 'Intent: COMPLAINT | Tiket: LAP-20261001-005',
      appendSummary: true, hasOutcome: true,
    });

    endSessionNow(userKey); // tanpa majukan waktu
    await flushPromises();
    await flushPromises();

    expect(mockedCreate).toHaveBeenCalledTimes(1);
    endSessionNow(userKey); // panggilan kedua tidak double-save
    await flushPromises();
    expect(mockedCreate).toHaveBeenCalledTimes(1);
  });

  it('checkSessionEnd dalam batas idle tidak menyimpan apa-apa', async () => {
    const userKey = '6287777777777';
    noteSessionTurn({
      userKey, wa_user_id: userKey,
      summary: 'Intent: COMPLAINT | Tiket: LAP-20261001-006',
      appendSummary: true, hasOutcome: true,
    });

    // Hanya 5 menit berlalu — session masih aktif.
    vi.setSystemTime(new Date(T0.getTime() + 5 * 60 * 1000));
    checkSessionEnd(userKey);
    await flushPromises();

    expect(mockedCreate).not.toHaveBeenCalled();
    expect(SESSION_IDLE_TIMEOUT_MS).toBe(30 * 60 * 1000);
  });
});

describe('summarizeTurnForSession', () => {
  it('membangun ringkasan deterministik tanpa transcript mentah', () => {
    const summary = summarizeTurnForSession(
      baseResult({
        intent: 'STATUS_CHECK',
        response: 'Status tiket LAP-20261001-007: sedang diproses. NIK 1234567890123456 aman.',
        metadata: {
          processingTimeMs: 10,
          hasKnowledge: false,
          toolsUsed: ['get_complaint_status', 'search_kb'],
        },
      }),
    );
    expect(summary).toContain('Intent: STATUS_CHECK');
    expect(summary).toContain('Tiket: LAP-20261001-007');
    expect(summary).toContain('get_complaint_status');
    // Tidak membawa kalimat respons / transcript mentah.
    expect(summary).not.toContain('sedang diproses');
    expect(summary).not.toContain('1234567890123456');
  });

  it('melewati intent trivial GREETING/ERROR', () => {
    expect(summarizeTurnForSession(baseResult({ intent: 'GREETING' }))).toBe('');
    expect(summarizeTurnForSession(baseResult({ intent: 'ERROR' }))).toBe('');
  });
});
