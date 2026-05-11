/**
 * Scenario evaluation suite — mirrors production audit cases for user 6281233784490.
 *
 * These are NOT unit tests. They exercise the pre-agent router end-to-end to
 * make sure the routing decisions that were wrong in production (contact
 * lookup falling into emergency, complaint follow-up dropping back into the
 * agent) are now deterministic.
 *
 * We mock the external HTTP (dashboard + case-service) and the NLU classifier
 * so the router can run offline. The intent of each assertion matches the
 * audit expectations from the upstream report.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Mocks ──

vi.mock('axios', () => {
  const get = vi.fn();
  const post = vi.fn();
  return { default: { get, post }, get, post };
});

vi.mock('../case-client.service', () => ({
  getServiceCatalog: vi.fn(),
  getUserHistory: vi.fn().mockResolvedValue({ total: 0, combined: [], services: [], complaints: [] }),
  cancelComplaint: vi.fn(),
  cancelServiceRequest: vi.fn(),
  getComplaintStatusWithOwnership: vi.fn().mockResolvedValue({ success: false }),
  getServiceRequestStatusWithOwnership: vi.fn().mockResolvedValue({ success: false }),
  createComplaint: vi.fn().mockResolvedValue('LAP-20260510-001'),
  getComplaintTypes: vi.fn().mockResolvedValue([
    {
      id: 'ct1',
      name: 'kecelakaan',
      is_urgent: true,
      require_address: true,
      send_important_contacts: true,
      category: { name: 'Darurat' },
    },
  ]),
  buildServiceInfoContext: vi.fn(),
  requestServiceRequestEditToken: vi.fn(),
  updateComplaintByUser: vi.fn(),
}));

vi.mock('../micro-llm-matcher.service', () => ({
  extractNameViaNLU: vi.fn().mockResolvedValue(null),
  analyzeAddress: vi.fn().mockImplementation(async (message: string) => {
    if (!message || message.length < 5) return { quality: 'too_short', has_address: false };
    if (/jalan|jl\.|rt|rw|dusun|depan|belakang|samping|no\.?\s*\d+|radio|sman/i.test(message)) {
      return { quality: 'usable', has_address: true, address: message };
    }
    return { quality: 'not_address', has_address: false };
  }),
  classifyMessage: vi.fn().mockResolvedValue({ message_type: 'QUESTION', confidence: 0.5 }),
  classifyUpdateIntent: vi.fn(),
  matchComplaintType: vi.fn(),
  summarizeConversation: vi.fn(),
}));

vi.mock('../confirmation-classifier.service', () => ({
  classifyConfirmation: vi.fn().mockResolvedValue({ decision: 'UNCERTAIN' }),
}));

vi.mock('../ump-state', async () => {
  // Use a light in-memory implementation so pending-state transitions are visible.
  const storage: Record<string, any> = {};
  const make = (name: string) => ({
    set: (id: string, data: any) => { storage[`${name}:${id}`] = data; },
    get: (id: string) => storage[`${name}:${id}`],
    delete: (id: string) => { delete storage[`${name}:${id}`]; },
  });
  const addressRequest = make('address_request');
  const serviceFormOffer = make('service_form_offer');
  const emergencyOffer = make('emergency_offer');
  const complaintData = make('complaint_data');
  const activeServiceInfo = make('active_service_info');
  const pendingServiceClarification = make('service_clarification');
  const addressConfirmation = make('address_confirmation');
  const cancelConfirmation = make('cancel_confirmation');

  return {
    MAX_PHOTOS_PER_COMPLAINT: 5,
    addPendingPhoto: vi.fn(),
    clearActiveServiceInfo: vi.fn((id) => activeServiceInfo.delete(id)),
    clearPendingAddressRequest: vi.fn((id) => addressRequest.delete(id)),
    clearPendingCancelConfirmation: vi.fn((id) => cancelConfirmation.delete(id)),
    clearPendingComplaintData: vi.fn((id) => complaintData.delete(id)),
    clearPendingEmergencyComplaintOffer: vi.fn((id) => emergencyOffer.delete(id)),
    clearPendingServiceClarification: vi.fn((id) => pendingServiceClarification.delete(id)),
    clearPendingServiceFormOffer: vi.fn((id) => serviceFormOffer.delete(id)),
    getActiveServiceInfoWithFallback: vi.fn(async (id) => activeServiceInfo.get(id)),
    getPendingServiceClarificationWithFallback: vi.fn(async (id) => pendingServiceClarification.get(id)),
    getPendingAddressConfirmationWithFallback: vi.fn(async (id) => addressConfirmation.get(id)),
    getPendingAddressRequestWithFallback: vi.fn(async (id) => addressRequest.get(id)),
    getPendingCancelConfirmationWithFallback: vi.fn(async (id) => cancelConfirmation.get(id)),
    getPendingComplaintDataWithFallback: vi.fn(async (id) => complaintData.get(id)),
    getPendingEmergencyComplaintOfferWithFallback: vi.fn(async (id) => emergencyOffer.get(id)),
    getPendingPhotoCount: vi.fn().mockReturnValue(0),
    getPendingServiceFormOfferWithFallback: vi.fn(async (id) => serviceFormOffer.get(id)),
    setActiveServiceInfo: vi.fn((id, data) => activeServiceInfo.set(id, data)),
    setPendingAddressRequest: vi.fn((id, data) => addressRequest.set(id, data)),
    setPendingComplaintData: vi.fn((id, data) => complaintData.set(id, data)),
    setPendingEmergencyComplaintOffer: vi.fn((id, data) => emergencyOffer.set(id, data)),
    setPendingServiceClarification: vi.fn((id, data) => pendingServiceClarification.set(id, data)),
    setPendingServiceFormOffer: vi.fn((id, data) => serviceFormOffer.set(id, data)),
    syncNameToChannelService: vi.fn(),
  };
});

vi.mock('../ump-utils', async () => {
  return {
    appendToHistoryCache: vi.fn(),
    extractAddressFromMessage: vi.fn().mockImplementation(async (message: string) => {
      if (!message || message.length < 5) return '';
      if (/jalan|jl\.|rt|rw|dusun|depan|belakang|samping|no\.?\s*\d+|radio|sman/i.test(message)) {
        return message;
      }
      return '';
    }),
    fetchConversationHistoryFromChannel: vi.fn().mockResolvedValue([]),
    extractNameFromTextNLU: vi.fn().mockResolvedValue(null),
    deriveLastDiscussedServiceContext: vi.fn().mockReturnValue({}),
    buildAgentConversationContext: vi.fn().mockResolvedValue({ recentMessages: [] }),
    isVagueAddress: vi.fn().mockResolvedValue(false),
    resolveComplaintTypeConfig: vi.fn().mockImplementation(async (kategori: string) => ({
      name: kategori || 'kecelakaan',
      is_urgent: true,
      require_address: true,
      send_important_contacts: true,
      category: { name: 'Darurat' },
    })),
    getCachedComplaintTypes: vi.fn().mockResolvedValue([]),
  };
});

vi.mock('../complaint-handler', () => ({
  handleComplaintCreation: vi.fn().mockImplementation(async (_userId, _channel, payload) => {
    const fields = payload?.fields || {};
    if (!fields.alamat) {
      return 'Baik Pak/Bu, mohon sebutkan lokasi kejadian ya.';
    }
    return 'Terima kasih.\nLaporan telah kami terima dengan nomor LAP-20260510-001.';
  }),
  handleCancellationRequest: vi.fn(),
  handlePendingAddressConfirmation: vi.fn(),
  handleComplaintUpdate: vi.fn(),
  handleHistory: vi.fn(),
  buildComplaintCategoriesText: vi.fn().mockResolvedValue(''),
}));

vi.mock('../service-handler', () => ({
  handleServiceInfo: vi.fn(),
  handleServiceRequestCreation: vi.fn().mockResolvedValue({ replyText: 'link oke', guidanceText: 'Link formulir' }),
  handleServiceRequestEditLink: vi.fn().mockResolvedValue({ replyText: 'edit oke' }),
  resolveServiceSlugFromSearch: vi.fn(),
}));

vi.mock('../status-handler', () => ({
  handleStatusCheck: vi.fn().mockResolvedValue('Status laporan: OPEN'),
}));

vi.mock('../hybrid-memory.service', () => ({
  rememberMemoryEvent: vi.fn(),
  searchUserMemories: vi.fn().mockResolvedValue([]),
  buildHybridMemorySummary: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../user-profile.service', () => ({
  getAutoFillSuggestionsWithFallback: vi.fn().mockResolvedValue({}),
  updateProfile: vi.fn(),
  saveDefaultAddress: vi.fn(),
  recordComplaintCreated: vi.fn(),
  recordServiceUsage: vi.fn(),
  getProfile: vi.fn().mockReturnValue({}),
}));

vi.mock('../channel-client.service', () => ({
  updateConversationUserProfile: vi.fn().mockResolvedValue(true),
}));

// Margahayu data
const MARGAHAYU_CONTACTS = [
  {
    id: '1',
    name: 'Damkar Bola',
    phone: '+62 811-0000-1111',
    description: 'Pemadam Kebakaran Bola',
    category: { id: 'c1', name: 'Darurat' },
  },
  {
    id: '2',
    name: 'Polsek Bola',
    phone: '+62 811-0000-2222',
    description: 'Kepolisian Sektor Bola',
    category: { id: 'c2', name: 'Keamanan' },
  },
  {
    id: '3',
    name: 'Pak Andi Aswin',
    phone: '+62 811-0000-3333',
    description: 'Kepala Puskesmas Solo',
    category: { id: 'c3', name: 'Puskesmas' },
  },
  {
    id: '4',
    name: 'Pak Heru',
    phone: '+62 811-0000-4444',
    description: 'Kepala Desa Margahayu',
    category: { id: 'c4', name: 'Pemerintah Desa' },
  },
];

const MARGAHAYU_SERVICES = [
  { slug: 'ktp-baru', name: 'Perekaman KTP', is_active: true, category: { name: 'Kependudukan' } },
  { slug: 'surat-domisili', name: 'Surat Keterangan Domisili', is_active: true, category: { name: 'Surat' } },
  { slug: 'surat-usaha', name: 'Surat Keterangan Usaha', is_active: true, category: { name: 'Surat' } },
];

// ── Helper: call the pre-agent contact-shortcut path ──

import axios from 'axios';
import {
  tryHandleLatePreAgentState,
  tryHandleServiceListingShortcut,
  isServiceListingQuery,
} from '../pre-agent-state-router.service';
import * as contactsService from '../important-contacts.service';
import { getServiceCatalog } from '../case-client.service';

describe('Production audit scenarios', () => {
  beforeEach(() => {
    (axios.get as any).mockReset();
    (axios.get as any).mockResolvedValue({ data: { data: MARGAHAYU_CONTACTS } });
    (getServiceCatalog as any).mockReset();
    (getServiceCatalog as any).mockResolvedValue(MARGAHAYU_SERVICES);
  });

  describe('A. Contact directory lookup', () => {
    it('"ada nomor puskesmas solo?" → Pak Andi Aswin match', async () => {
      const lookup = await contactsService.lookupImportantContacts(
        'ada nomor puskesmas solo?',
        'village-margahayu',
      );
      expect(lookup.matches.length).toBeGreaterThan(0);
      const haystack = `${lookup.matches[0].contact.name} ${lookup.matches[0].contact.description}`.toLowerCase();
      expect(haystack).toMatch(/puskesmas|solo/);
    });

    it('"nomor kepala desa?" → Pak Heru match', async () => {
      const lookup = await contactsService.lookupImportantContacts(
        'nomor kepala desa?',
        'village-margahayu',
      );
      expect(lookup.matches.length).toBeGreaterThan(0);
      const top = lookup.matches[0];
      expect(top.contact.description?.toLowerCase()).toContain('kepala desa');
    });

    it('"ada nomor pemadam kebakaran?" → routed to contact directory', async () => {
      expect(contactsService.isContactDirectoryLookup('ada nomor pemadam kebakaran?')).toBe(true);
      const lookup = await contactsService.lookupImportantContacts(
        'ada nomor pemadam kebakaran?',
        'village-margahayu',
      );
      expect(lookup.matches.length).toBeGreaterThan(0);
      expect(lookup.matches[0].contact.name.toLowerCase()).toContain('damkar');
    });
  });

  describe('B. Active emergency', () => {
    it('"rumah saya kebakaran tolong" → NOT a directory lookup', () => {
      expect(contactsService.isContactDirectoryLookup('rumah saya kebakaran tolong')).toBe(false);
    });

    it('"ada kecelakaan di depan sekolah" → NOT a directory lookup', () => {
      expect(contactsService.isContactDirectoryLookup('ada kecelakaan di depan sekolah tolong')).toBe(false);
    });

    it('ambiguous incident without active-event signal defers to agent (no auto-route)', async () => {
      // An "ada kecelakaan di pertigaan desa" message without any urgency
      // phrase (tolong, segera, barusan, ya allah, etc.) should NOT be
      // auto-routed to emergency OR complaint at the guard layer. The agent
      // handles clarification so we do not fabricate intent.
      const result = await tryHandleLatePreAgentState({
        userId: 'user-6281233784490',
        message: 'ada kecelakaan di pertigaan desa, korban banyak',
        channel: 'whatsapp',
        villageId: 'village-margahayu',
        traceId: 'trace-incident',
        startTime: Date.now(),
        runWithMicroBudget: async (task: any, fallback: any) => {
          try { return await task(); } catch { return fallback; }
        },
        tracker: { preparing: vi.fn(), complete: vi.fn() },
        notifyStage: vi.fn(),
      });

      // Either no guard match (null → let agent handle) or complaint route
      // is acceptable. What must NOT happen is a bare EMERGENCY_CONTACTS
      // offer that hijacks the turn.
      if (result) {
        expect(result.intent).not.toBe('EMERGENCY_CONTACTS');
      }
    });
  });

  describe('C. Complaint FSM resume', () => {
    it('pending address + "didepan sman 1 margahayu jalan radio" → deterministic resume', async () => {
      const tracker = { preparing: vi.fn(), complete: vi.fn() };
      const notifyStage = vi.fn();

      // Seed pending state directly via the mocked ump-state (bypass the public API,
      // since scripting the full complaint turn 1 is outside this test's scope).
      const ump = await import('../ump-state');
      (ump as any).setPendingAddressRequest('user-6281233784490', {
        kategori: 'kecelakaan',
        deskripsi: 'Laporan kecelakaan',
        village_id: 'village-margahayu',
        timestamp: Date.now(),
      });

      const result = await tryHandleLatePreAgentState({
        userId: 'user-6281233784490',
        message: 'didepan sman 1 margahayu jalan radio',
        channel: 'whatsapp',
        villageId: 'village-margahayu',
        traceId: 'trace-audit',
        startTime: Date.now(),
        runWithMicroBudget: async (task: any, fallback: any) => {
          try { return await task(); } catch { return fallback; }
        },
        tracker,
        notifyStage,
      });

      expect(result).not.toBeNull();
      expect(result?.intent).toBe('CREATE_COMPLAINT');
      expect(result?.response).toMatch(/(LAP-|mohon|sebutkan)/i);
      expect(result?.metadata.guardrail?.type).toBe('complaint_fsm_resume');
    });

    it('emergency shortcut stores resolved complaint type and original description for follow-up', async () => {
      const tracker = { preparing: vi.fn(), complete: vi.fn() };
      const notifyStage = vi.fn();
      const userId = 'user-emergency-state';
      const ump = await import('../ump-state');
      const umpUtils = await import('../ump-utils');

      (umpUtils.resolveComplaintTypeConfig as any).mockResolvedValueOnce({
        name: 'kecelakaan',
        is_urgent: true,
        require_address: true,
        send_important_contacts: true,
        category: { name: 'Darurat' },
      });

      const result = await tryHandleLatePreAgentState({
        userId,
        message: 'rumah saya kebakaran tolong',
        channel: 'whatsapp',
        villageId: 'village-margahayu',
        traceId: 'trace-emergency-state',
        startTime: Date.now(),
        runWithMicroBudget: async (task: any, fallback: any) => {
          try { return await task(); } catch { return fallback; }
        },
        tracker,
        notifyStage,
      });

      const pendingEmergency = await (ump as any).getPendingEmergencyComplaintOfferWithFallback(userId);
      expect(result).not.toBeNull();
      expect(result?.intent).toBe('EMERGENCY_CONTACTS');
      expect(pendingEmergency?.kategori).toBe('kecelakaan');
      expect(pendingEmergency?.deskripsi).toBe('rumah saya kebakaran tolong');
      expect(pendingEmergency?.contact_entity).toBe('rumah saya kebakaran tolong');
    });
  });

  describe('D. Service listing deterministic', () => {
    it('"layanan apa aja yg bisa dilakukan disini?" is recognized as listing', () => {
      expect(isServiceListingQuery('layanan apa aja yg bisa dilakukan disini?')).toBe(true);
    });

    it('service listing shortcut returns catalog-grounded response', async () => {
      const result = await tryHandleServiceListingShortcut({
        message: 'layanan apa aja',
        villageId: 'village-margahayu',
        traceId: 'trace-listing',
        startTime: Date.now(),
      });

      expect(result).not.toBeNull();
      expect(result?.intent).toBe('SERVICE_INFO');
      expect(result?.response).toMatch(/(Perekaman KTP|Surat Keterangan)/);
      expect(result?.metadata.guardrail?.reason).toBe('deterministic_catalog');
    });
  });
});
