/**
 * P1-12 — Village scoping tests for the get_complaint_categories agent tool.
 *
 * Rule under test (fail-closed): the tool must pass the caller's village_id
 * to the scoped query, and must refuse to run at all when no village_id is
 * present — never issuing an unscoped query that could mix villages' data.
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
}));

vi.mock('../case-client.service', () => ({
  cancelComplaint: vi.fn(async () => null),
  cancelServiceRequest: vi.fn(async () => null),
  createComplaint: vi.fn(async () => 'LAP-TEST-001'),
  getComplaintStatusWithOwnership: vi.fn(async () => null),
  getComplaintTypes: vi.fn(async () => []),
  requestServiceRequestEditToken: vi.fn(async () => null),
  buildServiceInfoContext: vi.fn(async () => null),
  getServiceCatalog: vi.fn(async () => []),
  getServiceRequestStatusWithOwnership: vi.fn(async () => null),
  getUserHistory: vi.fn(async () => []),
  updateComplaintByUser: vi.fn(async () => null),
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

import { getComplaintTypes } from '../case-client.service';
import { executeToolCall } from '../agent/tool-executor';

const ctxVillageA = {
  userId: '6281234567890',
  villageId: 'village-a',
  channel: 'whatsapp' as const,
  sideEffectMode: 'production' as const,
};

const ctxNoVillage = {
  userId: '6281234567890',
  channel: 'whatsapp' as const,
  sideEffectMode: 'production' as const,
};

function seedVillageATypes() {
  return [
    {
      id: 'type-a1',
      name: 'Jalan Rusak',
      category_id: 'cat-a1',
      is_urgent: false,
      require_address: true,
      send_important_contacts: false,
      important_contact_category: null,
      important_contact_category_id: null,
      category: { id: 'cat-a1', name: 'Infrastruktur', village_id: 'village-a' },
    },
    {
      id: 'type-a2',
      name: 'Sampah Menumpuk',
      category_id: 'cat-a2',
      is_urgent: false,
      require_address: false,
      send_important_contacts: false,
      important_contact_category: null,
      important_contact_category_id: null,
      category: { id: 'cat-a2', name: 'Kebersihan', village_id: 'village-a' },
    },
  ];
}

describe('P1-12 get_complaint_categories village scoping (tool)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('passes the caller village_id to the scoped query and returns only that village data', async () => {
    vi.mocked(getComplaintTypes).mockResolvedValue(seedVillageATypes() as any);

    const executed = await executeToolCall('get_complaint_categories', {}, ctxVillageA);

    expect(executed.result.success).toBe(true);
    expect(getComplaintTypes).toHaveBeenCalledTimes(1);
    expect(getComplaintTypes).toHaveBeenCalledWith('village-a');
    const types = (executed.result.data as any).complaint_types;
    expect(types).toHaveLength(2);
    expect(types.map((t: any) => t.type_id).sort()).toEqual(['type-a1', 'type-a2']);
    expect(types.every((t: any) => t.category_id !== 'cat-b1')).toBe(true);
  });

  it('fail-closed: refuses without village_id and never issues the query', async () => {
    const executed = await executeToolCall('get_complaint_categories', {}, ctxNoVillage);

    expect(executed.result.success).toBe(false);
    expect(getComplaintTypes).not.toHaveBeenCalled();
    expect(String(executed.result.error)).toMatch(/village_id/i);
  });
});
