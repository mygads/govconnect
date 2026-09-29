/**
 * Tests for P2-9 (deep audit): the fallback ticket reference shown to the
 * citizen must actually exist in the DB — no silent collision loss.
 *
 * - buildFallback honors an explicitly issued ticketRef.
 * - issueFallback mints + persists + audits atomically; the response embeds
 *   the SAME ref that was inserted.
 * - On id collision the id is re-minted (ON CONFLICT DO NOTHING surfaced as
 *   'conflict'); the user never sees the collided ref.
 * - persist:false (shadow/evaluation) writes nothing but still replies.
 * - DB unavailable: unpersisted ref, but never silent.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../pipeline-store', () => ({
  createFallbackTicket: vi.fn(),
  appendAudit: vi.fn(async () => true),
}));

import { createFallbackTicket, appendAudit } from '../pipeline-store';
import {
  buildFallback,
  issueFallback,
  mintTempTicket,
  assertNonEmptyResponse,
  type FallbackInput,
} from '../fallback-policy';

const mockCreate = vi.mocked(createFallbackTicket);
const mockAudit = vi.mocked(appendAudit);

const baseInput: FallbackInput = {
  stage: 'TRIAGE',
  terminalState: 'FAILED',
  userId: 'u1',
  traceId: 't1',
  tenantId: 'v1',
  channel: 'whatsapp',
};

describe('fallback-policy atomic issuance (P2-9)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('buildFallback honors an explicit ticketRef', () => {
    const fb = buildFallback(baseInput, 'TMP-20240101-ABCDEF');
    expect(fb.ticketRef).toBe('TMP-20240101-ABCDEF');
    expect(fb.response).toContain('TMP-20240101-ABCDEF');
  });

  it('issueFallback persists then replies with the SAME ref', async () => {
    mockCreate.mockResolvedValue('inserted');
    const fb = await issueFallback(baseInput);
    expect(mockCreate).toHaveBeenCalledTimes(1);
    const sentId = mockCreate.mock.calls[0]![0].ticketId;
    expect(fb.ticketRef).toBe(sentId);
    expect(fb.response).toContain(sentId);
    expect(fb.persisted).toBe(true);
    expect(mockAudit).toHaveBeenCalledTimes(1);
    const auditPayload = mockAudit.mock.calls[0]![0] as unknown as { payload: { ticketRef: string; persisted: boolean } };
    expect(auditPayload.payload.ticketRef).toBe(sentId);
    expect(auditPayload.payload.persisted).toBe(true);
  });

  it('re-mints on id collision; the citizen never sees the collided ref', async () => {
    mockCreate.mockResolvedValueOnce('conflict').mockResolvedValueOnce('inserted');
    const fb = await issueFallback(baseInput);
    expect(mockCreate).toHaveBeenCalledTimes(2);
    const firstId = mockCreate.mock.calls[0]![0].ticketId;
    const secondId = mockCreate.mock.calls[1]![0].ticketId;
    expect(firstId).not.toBe(secondId);
    expect(fb.ticketRef).toBe(secondId);
    expect(fb.response).toContain(secondId);
    expect(fb.response).not.toContain(firstId);
    expect(fb.persisted).toBe(true);
  });

  it('persist:false writes nothing (shadow mode) but still replies', async () => {
    const fb = await issueFallback(baseInput, { persist: false });
    expect(mockCreate).not.toHaveBeenCalled();
    expect(mockAudit).not.toHaveBeenCalled();
    expect(fb.persisted).toBe(false);
    expect(fb.response).toContain(fb.ticketRef);
    assertNonEmptyResponse(fb.response, 'test');
  });

  it('DB unavailable: unpersisted ref, never silent', async () => {
    mockCreate.mockResolvedValue('unavailable');
    const fb = await issueFallback(baseInput);
    expect(fb.persisted).toBe(false);
    expect(fb.ticketRef).toMatch(/^TMP-/);
    expect(fb.response.trim().length).toBeGreaterThan(0);
    expect(fb.response).toContain(fb.ticketRef);
  });

  it('honest copy: only claims "sudah tercatat" when actually persisted', async () => {
    mockCreate.mockResolvedValue('inserted');
    const ok = await issueFallback(baseInput);
    expect(ok.persisted).toBe(true);
    expect(ok.response).toContain('sudah tercatat');
    expect(ok.response).toContain('petugas desa akan menindaklanjuti');

    mockCreate.mockResolvedValue('unavailable');
    const down = await issueFallback(baseInput);
    expect(down.persisted).toBe(false);
    expect(down.response).not.toContain('sudah tercatat');
    expect(down.response).toContain('BELUM tersimpan');
    expect(down.response).toContain('kirim ulang');
  });

  it('mintTempTicket format is stable', () => {
    expect(mintTempTicket()).toMatch(/^TMP-\d{8}-[0-9A-F]{6}$/);
  });
});
