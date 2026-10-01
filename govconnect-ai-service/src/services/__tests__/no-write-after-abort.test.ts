/**
 * P1-5 no-write-after-abort.
 *
 * Verifies that once a turn is aborted, no mutation path performs its DB
 * write (via the case-service client), and that the failure is fail-closed
 * (unsuccessful result, no success claim). Also verifies the normal
 * (non-aborted) flow still writes — no regression.
 *
 * NOTE: complaint/service-request rows live in case-service; the ai-service
 * writes them through HTTP calls in `case-client.service`. "No DB write" is
 * therefore asserted as "the case-client write function was never called".
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../utils/logger', () => ({
  default: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

vi.mock('../important-contacts.service', () => ({
  getImportantContacts: vi.fn(async () => []),
  lookupImportantContacts: vi.fn(async () => ({
    matches: [],
    total_candidates: 0,
    category_hint: null,
    role_hint: null,
  })),
  isConfidentContactLookupResult: () => false,
  shouldAttachEmergencyLookupContacts: () => false,
}));

vi.mock('../case-client.service', () => ({
  cancelComplaint: vi.fn(async () => ({ success: true, message: 'Dibatalkan' })),
  cancelServiceRequest: vi.fn(async () => ({ success: true, message: 'Dibatalkan' })),
  createComplaint: vi.fn(async () => 'LAP-TEST-001'),
  getComplaintStatusWithOwnership: vi.fn(async () => null),
  getComplaintTypes: vi.fn(async () => []),
  requestServiceRequestEditToken: vi.fn(async () => null),
  buildServiceInfoContext: vi.fn(async () => null),
  getServiceCatalog: vi.fn(async () => []),
  getServiceRequestStatusWithOwnership: vi.fn(async () => null),
  getUserHistory: vi.fn(async () => []),
  updateComplaintByUser: vi.fn(async () => ({ success: true, message: 'ok' })),
}));

vi.mock('../hybrid-memory.service', () => ({
  rememberMemoryEvent: vi.fn(async () => {}),
  searchUserMemories: vi.fn(async () => []),
}));

vi.mock('../knowledge.service', () => ({
  searchDocuments: vi.fn(async () => []),
  searchKnowledge: vi.fn(async () => []),
  getVillageProfileSummary: vi.fn(async () => null),
}));

vi.mock('../runtime-observability.service', () => ({
  recordMemoryTrace: vi.fn(async () => {}),
}));

vi.mock('../service-handler', () => ({
  resolveServiceSlugFromSearch: vi.fn(async () => null),
}));

vi.mock('../ump-utils', () => ({
  resolveVillageSlugForPublicForm: vi.fn(async () => 'desa-test'),
}));

vi.mock('../ump-formatters', () => ({
  buildCancelErrorResponse: vi.fn(() => 'cancel error'),
  buildCancelSuccessResponse: vi.fn(() => 'cancel success'),
  buildHistoryResponse: vi.fn(() => 'history'),
  buildNaturalServiceStatusResponse: vi.fn(() => 'service status'),
  buildNaturalStatusResponse: vi.fn(() => 'complaint status'),
  buildEditServiceFormUrl: vi.fn(() => 'https://example.test/edit'),
  buildPublicServiceFormUrl: vi.fn(() => 'https://example.test/form'),
  buildImportantContactsMessage: vi.fn(() => ''),
  getPublicFormBaseUrl: vi.fn(() => 'https://example.test'),
  getStatusLabel: vi.fn(() => 'OPEN'),
  toVCardContacts: vi.fn((contacts: any[]) => contacts),
}));

vi.mock('../ump-state', () => ({
  clearPendingServiceClarification: vi.fn(),
  setActiveServiceInfo: vi.fn(),
  setPendingAddressRequest: vi.fn(),
  setPendingCancelConfirmation: vi.fn(),
  setPendingServiceClarification: vi.fn(),
  setPendingServiceFormOffer: vi.fn(),
}));

vi.mock('../user-profile.service', () => ({
  getAutoFillSuggestionsWithFallback: vi.fn(async () => ({})),
  recordComplaintCreated: vi.fn(),
  recordServiceUsage: vi.fn(),
  saveDefaultAddress: vi.fn(),
  updateProfile: vi.fn(),
}));

vi.mock('../channel-client.service', () => ({
  updateConversationUserProfile: vi.fn(async () => true),
}));

import {
  createComplaint,
  cancelServiceRequest,
  getComplaintTypes,
} from '../case-client.service';
import { getAutoFillSuggestionsWithFallback } from '../user-profile.service';
import { executeToolCall } from '../agent/tool-executor';
import {
  assertNotAborted,
  isAborted,
  TurnAbortedError,
  TURN_ABORTED_BEFORE_WRITE,
} from '../../pipeline/abort-guard';

const baseCtx = {
  userId: '6281234567890',
  villageId: 'village-1',
  channel: 'whatsapp' as const,
  sideEffectMode: 'production' as const,
};

const complaintArgs = {
  kategori: 'Jalan Rusak',
  deskripsi: 'Jalan berlubang besar di depan balai desa, sangat membahayakan pengendara motor',
  alamat: 'Jl. Raya Desa No. 10',
};

function flushMicrotasks(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve));
}

describe('abort-guard primitives', () => {
  it('isAborted is false for a fresh or missing signal, true after abort', () => {
    expect(isAborted(undefined)).toBe(false);
    expect(isAborted(null)).toBe(false);
    const controller = new AbortController();
    expect(isAborted(controller.signal)).toBe(false);
    controller.abort();
    expect(isAborted(controller.signal)).toBe(true);
  });

  it('assertNotAborted throws TurnAbortedError only when aborted', () => {
    expect(() => assertNotAborted(undefined, 'op')).not.toThrow();
    const controller = new AbortController();
    expect(() => assertNotAborted(controller.signal, 'op')).not.toThrow();
    controller.abort();
    try {
      assertNotAborted(controller.signal, 'create_complaint');
      expect.unreachable('should have thrown');
    } catch (err: any) {
      expect(err).toBeInstanceOf(TurnAbortedError);
      expect(err.code).toBe(TURN_ABORTED_BEFORE_WRITE);
      expect(err.message).toContain('create_complaint');
    }
  });
});

describe('P1-5 no-write-after-abort: complaint create', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getComplaintTypes).mockResolvedValue([
      {
        id: 'cat-1',
        name: 'Jalan Rusak',
        slug: 'jalan-rusak',
        is_urgent: false,
        send_important_contacts: false,
      },
    ] as any);
    vi.mocked(createComplaint).mockResolvedValue('LAP-TEST-001' as any);
    vi.mocked(getAutoFillSuggestionsWithFallback).mockResolvedValue({} as any);
  });

  it('(a) abort DURING the flow (mid pre-work) → createComplaint never called', async () => {
    // Hold the profile-fetch await open. The mock aborts the controller the
    // moment the tool reaches it — so the abort deterministically lands
    // mid-flow, between tool start and the write, with no timing race.
    const controller = new AbortController();
    let releaseProfile!: (value: Record<string, unknown>) => void;
    const profileGate = new Promise<Record<string, unknown>>((resolve) => {
      releaseProfile = resolve;
    });
    vi.mocked(getAutoFillSuggestionsWithFallback).mockImplementation(() => {
      controller.abort(); // user aborts while the tool is in pre-work
      return profileGate as any;
    });

    const execPromise = executeToolCall('create_complaint', complaintArgs, {
      ...baseCtx,
      abortSignal: controller.signal,
    });

    await flushMicrotasks(); // let the tool park on the profile gate
    expect(controller.signal.aborted).toBe(true); // sanity: abort landed mid-flow
    releaseProfile({});
    const executed = await execPromise;

    expect(createComplaint).not.toHaveBeenCalled();
    expect(executed.result.success).toBe(false);
  });

  it('(a2) already-aborted signal → createComplaint never called', async () => {
    const controller = new AbortController();
    controller.abort();

    // The entry guard in executeToolCall rejects fail-closed before the
    // tool even starts; the write must never happen.
    await expect(
      executeToolCall('create_complaint', complaintArgs, {
        ...baseCtx,
        abortSignal: controller.signal,
      }),
    ).rejects.toThrow('turn_aborted_before_tool_start');
    expect(createComplaint).not.toHaveBeenCalled();
  });

  it('(c) normal flow without abort → createComplaint called once (no regression)', async () => {
    const executed = await executeToolCall('create_complaint', complaintArgs, baseCtx);

    expect(createComplaint).toHaveBeenCalledTimes(1);
    expect(executed.result.success).toBe(true);
  });
});

describe('P1-5 no-write-after-abort: service-request flow', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(cancelServiceRequest).mockResolvedValue({
      success: true,
      message: 'Dibatalkan oleh pemohon',
    } as any);
  });

  it('(b) aborted turn → cancelServiceRequest never called for LAY-xxx', async () => {
    const controller = new AbortController();
    controller.abort();

    // The entry guard in executeToolCall rejects fail-closed before the
    // tool even starts; the write must never happen.
    await expect(
      executeToolCall(
        'cancel_request',
        { reference_number: 'LAY-20260101-001', confirmation: true, cancel_reason: 'salah pilih' },
        { ...baseCtx, abortSignal: controller.signal },
      ),
    ).rejects.toThrow('turn_aborted_before_tool_start');
    expect(cancelServiceRequest).not.toHaveBeenCalled();
  });

  it('(c2) normal flow without abort → cancelServiceRequest called once (no regression)', async () => {
    const executed = await executeToolCall(
      'cancel_request',
      { reference_number: 'LAY-20260101-001', confirmation: true, cancel_reason: 'salah pilih' },
      baseCtx,
    );

    expect(cancelServiceRequest).toHaveBeenCalledTimes(1);
    expect(executed.result.success).toBe(true);
  });
});
