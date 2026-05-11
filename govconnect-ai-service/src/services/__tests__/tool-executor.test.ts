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
  lookupImportantContacts: vi.fn(async () => []),
}));

vi.mock('../case-client.service', () => ({
  cancelComplaint: vi.fn(async () => null),
  cancelServiceRequest: vi.fn(async () => null),
  createComplaint: vi.fn(async () => 'LAP-TEST-001'),
  getComplaintStatusWithOwnership: vi.fn(async () => null),
  getComplaintTypes: vi.fn(async () => [
    {
      id: 'cat-1',
      name: 'Jalan Rusak',
      slug: 'jalan-rusak',
      is_urgent: false,
      send_important_contacts: false,
    },
  ]),
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
  buildImportantContactsMessage: vi.fn((contacts) => contacts.length ? '\n\nKontak penting otomatis ikut dikirim.' : ''),
  getPublicFormBaseUrl: vi.fn(() => 'https://example.test'),
  getStatusLabel: vi.fn(() => 'OPEN'),
  toVCardContacts: vi.fn((contacts) => contacts.map((contact: any) => ({ name: contact.name, phone: contact.phone }))),
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

import { createComplaint, getComplaintTypes } from '../case-client.service';
import { getImportantContacts } from '../important-contacts.service';
import { searchKnowledge, getVillageProfileSummary } from '../knowledge.service';
import { executeToolCall } from '../agent/tool-executor';

const ctx = {
  userId: '6281234567890',
  villageId: 'village-1',
  channel: 'whatsapp' as const,
  sideEffectMode: 'production' as const,
};

describe('executeToolCall user-facing errors', () => {
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
    vi.mocked(searchKnowledge).mockResolvedValue([] as any);
    vi.mocked(getVillageProfileSummary).mockResolvedValue(null as any);
    vi.mocked(getImportantContacts).mockResolvedValue([] as any);
  });

  it('sanitizes retrieval tool failures before they reach the user', async () => {
    vi.mocked(searchKnowledge).mockRejectedValue(
      new Error('ProviderError ECONNREFUSED api_key=secret123 stack=traceback internal_code=RAG_500'),
    );

    const executed = await executeToolCall('search_knowledge', { query: 'syarat surat domisili' }, ctx);

    expect(executed.result.success).toBe(false);
    expect(executed.result.error).toBe('retrieval_tool_failed:search_knowledge');
    expect(executed.result.suggested_response).toContain('belum bisa mengambil informasi lengkap');
    expect(executed.result.suggested_response).not.toContain('ECONNREFUSED');
    expect(executed.result.suggested_response).not.toContain('secret123');
    expect(executed.result.suggested_response).not.toContain('RAG_500');
    expect(executed.trace.sourceKind).toBe('tool_error');
  });

  it('sanitizes mutation tool failures before they reach the user', async () => {
    vi.mocked(createComplaint).mockRejectedValue(
      new Error('PrismaClientKnownRequestError P2002 duplicate reporter_phone stack=/srv/app/createComplaint'),
    );

    const executed = await executeToolCall('create_complaint', {
      kategori: 'jalan rusak',
      alamat: 'Jl. Melati RT 01',
      deskripsi: 'Jalan rusak parah di depan balai desa.',
    }, ctx);

    expect(executed.result.success).toBe(false);
    expect(executed.result.error).toBe('mutation_tool_failed:create_complaint');
    expect(executed.result.suggested_response).toContain('sistem desa sedang ada kendala');
    expect(executed.result.suggested_response).not.toContain('P2002');
    expect(executed.result.suggested_response).not.toContain('PrismaClientKnownRequestError');
    expect(executed.result.suggested_response).not.toContain('reporter_phone');
    expect(executed.trace.sourceKind).toBe('tool_error');
  });

  it('sanitizes general read tool failures before they reach the user', async () => {
    vi.mocked(getVillageProfileSummary).mockRejectedValue(
      new Error('InternalError profile lookup failed at /internal/village-profile token=abc123'),
    );

    const executed = await executeToolCall('get_village_profile', {}, ctx);

    expect(executed.result.success).toBe(false);
    expect(executed.result.error).toBe('tool_failed:get_village_profile');
    expect(executed.result.suggested_response).toContain('sistem desa sedang lambat merespons');
    expect(executed.result.suggested_response).not.toContain('InternalError');
    expect(executed.result.suggested_response).not.toContain('/internal/village-profile');
    expect(executed.result.suggested_response).not.toContain('abc123');
    expect(executed.trace.sourceKind).toBe('tool_error');
  });

  it('returns grouped official complaint categories plus flat complaint type ids', async () => {
    vi.mocked(getComplaintTypes).mockResolvedValue([
      {
        id: 'type-1',
        name: 'Jalan Rusak',
        description: 'Kerusakan jalan lingkungan',
        category_id: 'category-1',
        is_urgent: true,
        require_address: true,
        send_important_contacts: true,
        important_contact_category: 'Darurat',
        important_contact_category_id: 'contact-category-1',
        category: { id: 'category-1', name: 'Infrastruktur', village_id: 'village-1' },
      },
    ] as any);

    const executed = await executeToolCall('get_complaint_categories', {}, ctx);
    const data = executed.result.data as any;

    expect(executed.result.success).toBe(true);
    expect(data.complaint_types).toEqual([
      expect.objectContaining({
        name: 'Jalan Rusak',
        type_id: 'type-1',
        category_id: 'category-1',
        type_name: 'Jalan Rusak',
        category_name: 'Infrastruktur',
        important_contact_category_id: 'contact-category-1',
        is_urgent: true,
        require_address: true,
        send_important_contacts: true,
      }),
    ]);
    expect(data.categories).toEqual([
      expect.objectContaining({
        category_id: 'category-1',
        category_name: 'Infrastruktur',
        type_count: 1,
        types: [
          expect.objectContaining({
            type_id: 'type-1',
            type_name: 'Jalan Rusak',
            category_name: 'Infrastruktur',
          }),
        ],
      }),
    ]);
    expect(data.selection_hint).toContain('Utamakan type_id resmi');
  });

  it('forwards official complaint type ids when create_complaint resolves a known type', async () => {
    vi.mocked(getComplaintTypes).mockResolvedValue([
      {
        id: 'type-1',
        name: 'Jalan Rusak',
        category_id: 'category-1',
        is_urgent: false,
        require_address: true,
        send_important_contacts: false,
        important_contact_category: null,
        important_contact_category_id: null,
        category: { id: 'category-1', name: 'Infrastruktur', village_id: 'village-1' },
      },
    ] as any);

    const executed = await executeToolCall('create_complaint', {
      kategori: 'jalan rusak',
      alamat: 'Jl. Melati RT 01',
      deskripsi: 'Jalan rusak parah di depan balai desa.',
    }, ctx);

    expect(executed.result.success).toBe(true);
    expect(createComplaint).toHaveBeenCalledWith(expect.objectContaining({
      kategori: 'Jalan Rusak',
      type_id: 'type-1',
      category_id: 'category-1',
    }));
    expect((executed.result.data as any).type_id).toBe('type-1');
    expect((executed.result.data as any).category_id).toBe('category-1');
  });

  it('creates complaint from official type_id without kategori string', async () => {
    vi.mocked(getComplaintTypes).mockResolvedValue([
      {
        id: 'type-1',
        name: 'Jalan Rusak',
        category_id: 'category-1',
        is_urgent: false,
        require_address: true,
        send_important_contacts: false,
        important_contact_category: null,
        important_contact_category_id: null,
        category: { id: 'category-1', name: 'Infrastruktur', village_id: 'village-1' },
      },
    ] as any);

    const executed = await executeToolCall('create_complaint', {
      type_id: 'type-1',
      alamat: 'Jl. Melati RT 01',
      deskripsi: 'Jalan rusak parah di depan balai desa.',
    }, ctx);

    expect(executed.result.success).toBe(true);
    expect(createComplaint).toHaveBeenCalledWith(expect.objectContaining({
      kategori: 'Jalan Rusak',
      type_id: 'type-1',
      category_id: 'category-1',
    }));
    expect((executed.result.data as any).type_id).toBe('type-1');
    expect((executed.result.data as any).category_id).toBe('category-1');
  });

  it('creates complaint from category_id when that category has a single official type', async () => {
    vi.mocked(getComplaintTypes).mockResolvedValue([
      {
        id: 'type-1',
        name: 'Jalan Rusak',
        category_id: 'category-1',
        is_urgent: false,
        require_address: true,
        send_important_contacts: false,
        important_contact_category: null,
        important_contact_category_id: null,
        category: { id: 'category-1', name: 'Infrastruktur', village_id: 'village-1' },
      },
    ] as any);

    const executed = await executeToolCall('create_complaint', {
      category_id: 'category-1',
      alamat: 'Jl. Melati RT 01',
      deskripsi: 'Jalan rusak parah di depan balai desa.',
    }, ctx);

    expect(executed.result.success).toBe(true);
    expect(createComplaint).toHaveBeenCalledWith(expect.objectContaining({
      kategori: 'Jalan Rusak',
      type_id: 'type-1',
      category_id: 'category-1',
    }));
    expect((executed.result.data as any).type_id).toBe('type-1');
    expect((executed.result.data as any).category_id).toBe('category-1');
  });

  it('queues important contact delivery in create_complaint without inline contact send', async () => {
    vi.mocked(getComplaintTypes).mockResolvedValue([
      {
        id: 'cat-1',
        name: 'Jalan Rusak',
        slug: 'jalan-rusak',
        category_id: 'complaint-category-1',
        is_urgent: true,
        require_address: false,
        send_important_contacts: true,
        important_contact_category: 'Darurat',
        important_contact_category_id: 'contact-category-1',
      },
    ] as any);

    const executed = await executeToolCall('create_complaint', {
      kategori: 'jalan rusak',
      alamat: 'Jl. Melati RT 01',
      deskripsi: 'Jalan rusak parah di depan balai desa.',
    }, ctx);

    expect(executed.result.success).toBe(true);
    expect(getImportantContacts).not.toHaveBeenCalled();
    expect((executed.result.data as any).send_important_contacts).toBe(true);
    expect((executed.result.data as any).contacts).toEqual([]);
    expect((executed.result.data as any).important_contacts).toEqual([]);
    expect((executed.result.data as any).suggested_response).toContain('Kontak penting terkait akan saya kirim terpisah setelah laporan dibuat.');
  });

  it('returns only emergency-tagged contacts from get_emergency_contacts', async () => {
    vi.mocked(getImportantContacts).mockResolvedValue([
      {
        id: '1',
        name: 'Admin Pelayanan Desa',
        phone: '0822222222',
        description: 'Nomor kantor utama',
        category: { id: 'gov', name: 'Pemerintah' },
      },
      {
        id: '2',
        name: 'Damkar Bola',
        phone: '0811111111',
        description: 'Pemadam kebakaran siaga 24 jam',
        category: { id: 'emergency', name: 'Darurat' },
      },
    ] as any);

    const executed = await executeToolCall('get_emergency_contacts', {}, ctx);
    const data = executed.result.data as any;

    expect(executed.result.success).toBe(true);
    expect(data.has_local_contacts).toBe(true);
    expect(data.contacts).toEqual([
      expect.objectContaining({
        name: 'Damkar Bola',
        phone: '0811111111',
      }),
    ]);
  });

  it('does not fall back to non-emergency contacts when no emergency contact matches', async () => {
    vi.mocked(getImportantContacts).mockResolvedValue([
      {
        id: '1',
        name: 'Admin Pelayanan Desa',
        phone: '0822222222',
        description: 'Nomor kantor utama',
        category: { id: 'gov', name: 'Pemerintah' },
      },
      {
        id: '2',
        name: 'Ketua RT 03',
        phone: '0833333333',
        description: 'Wilayah RT 03',
        category: { id: 'gov', name: 'Pemerintah' },
      },
    ] as any);

    const executed = await executeToolCall('get_emergency_contacts', {}, ctx);
    const data = executed.result.data as any;

    expect(executed.result.success).toBe(true);
    expect(data.contacts).toEqual([]);
    expect(data.total).toBe(0);
    expect(data.has_local_contacts).toBe(false);
    expect(data.suggested_response).toContain('belum menemukan kontak darurat resmi');
  });

  it('prioritizes official office contacts first in village profile output', async () => {
    vi.mocked(getVillageProfileSummary).mockResolvedValue({
      name: 'Desa Margahayu',
      address: 'Jl. Raya Desa No. 1',
    } as any);
    vi.mocked(getImportantContacts).mockResolvedValue([
      {
        id: '1',
        name: 'Kepala Desa Margahayu',
        phone: '0811111111',
        description: null,
        category: { id: 'gov', name: 'Pemerintah' },
      },
      {
        id: '2',
        name: 'Admin Pelayanan Kantor Desa',
        phone: '0822222222',
        description: 'Nomor kantor utama',
        category: { id: 'gov', name: 'Pemerintah' },
      },
      {
        id: '3',
        name: 'Sekretariat Desa Margahayu',
        phone: '0833333333',
        description: null,
        category: { id: 'gov', name: 'Pemerintah' },
      },
    ] as any);

    const executed = await executeToolCall('get_village_profile', {}, ctx);
    const data = executed.result.data as any;

    expect(executed.result.success).toBe(true);
    expect(data.office_contacts.map((contact: any) => contact.name)).toEqual([
      'Admin Pelayanan Kantor Desa',
      'Sekretariat Desa Margahayu',
      'Kepala Desa Margahayu',
    ]);
  });
});
