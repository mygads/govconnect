/**
 * Complaint FSM tests — focus on deterministic address resume + interrupt handling.
 *
 * These mirror the production audit scenarios:
 *   - "saya mau lapor tadi ada kecelakaan" → starts complaint flow
 *   - "didepan sman 1 margahayu jalan radio" → must resume, not fall through
 *   - contact-lookup interrupt while waiting should cleanly release
 *   - greeting should release, not get stuck
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../micro-llm-matcher.service', () => ({
  extractNameViaNLU: vi.fn().mockResolvedValue({ name: 'Budi Santoso', confidence: 0.9 }),
  analyzeAddress: vi.fn(),
  classifyMessage: vi.fn(),
  classifyUpdateIntent: vi.fn(),
  matchComplaintType: vi.fn(),
  summarizeConversation: vi.fn(),
}));

vi.mock('../ump-utils', () => ({
  extractAddressFromMessage: vi.fn(),
  resolveComplaintTypeConfig: vi.fn().mockResolvedValue({
    name: 'kecelakaan',
    is_urgent: true,
    require_address: true,
  }),
  getCachedComplaintTypes: vi.fn().mockResolvedValue([]),
  isVagueAddress: vi.fn().mockResolvedValue(false),
  appendToHistoryCache: vi.fn(),
  fetchConversationHistoryFromChannel: vi.fn().mockResolvedValue([]),
  extractNameFromTextNLU: vi.fn().mockResolvedValue(null),
  deriveLastDiscussedServiceContext: vi.fn().mockReturnValue({}),
  buildAgentConversationContext: vi.fn().mockResolvedValue({ recentMessages: [] }),
}));

import { decideAddressResume, detectComplaintInterrupt } from '../complaint-fsm.service';
import { extractAddressFromMessage } from '../ump-utils';
import { analyzeAddress } from '../micro-llm-matcher.service';

const BASE_PENDING = {
  kategori: 'kecelakaan',
  deskripsi: 'Laporan kecelakaan di jalan',
  village_id: 'village-margahayu',
  timestamp: Date.now(),
} as const;

describe('detectComplaintInterrupt', () => {
  it('returns "explicit_cancel" for batal', () => {
    expect(detectComplaintInterrupt('batal saja')).toBe('explicit_cancel');
  });

  it('returns "greeting" for halo', () => {
    expect(detectComplaintInterrupt('halo')).toBe('greeting');
  });

  it('returns "status_lookup" for a LAP- code', () => {
    expect(detectComplaintInterrupt('cek LAP-20251201-001')).toBe('status_lookup');
  });

  it('returns "contact_directory_interrupt" for "ada nomor kepala desa?"', () => {
    expect(detectComplaintInterrupt('ada nomor kepala desa?')).toBe('contact_directory_interrupt');
  });

  it('returns "service_info_switch" for "saya mau urus ktp"', () => {
    expect(detectComplaintInterrupt('saya mau urus ktp')).toBe('service_info_switch');
  });

  it('returns "none" for a plain address-looking message', () => {
    expect(detectComplaintInterrupt('didepan sman 1 margahayu jalan radio')).toBe('none');
  });
});

describe('decideAddressResume', () => {
  beforeEach(() => {
    (extractAddressFromMessage as any).mockReset();
    (analyzeAddress as any).mockReset();
  });

  it('resumes with the extracted address when NLU finds one', async () => {
    (extractAddressFromMessage as any).mockResolvedValue('Jalan Radio RT 03');

    const decision = await decideAddressResume({
      userId: 'user-1',
      message: 'didepan sman 1 margahayu jalan radio rt 03',
      pendingAddr: { ...BASE_PENDING },
      channel: 'whatsapp',
    });

    expect(decision.action).toBe('resume');
    if (decision.action === 'resume') {
      expect(decision.alamat).toBe('Jalan Radio RT 03');
      expect(decision.reason).toBe('nlu_extracted');
    }
  });

  it('accepts the raw message as address when NLU extraction fails but analysis is usable', async () => {
    (extractAddressFromMessage as any).mockResolvedValue('');
    (analyzeAddress as any).mockResolvedValue({ quality: 'usable', has_address: true });

    const decision = await decideAddressResume({
      userId: 'user-2',
      message: 'didepan sman 1 margahayu jalan radio',
      pendingAddr: { ...BASE_PENDING },
      channel: 'whatsapp',
    });

    expect(decision.action).toBe('resume');
    if (decision.action === 'resume') {
      expect(decision.alamat).toBe('didepan sman 1 margahayu jalan radio');
      expect(decision.reason).toBe('nlu_usable');
    }
  });

  it('re-prompts when NLU says the message is not an address', async () => {
    (extractAddressFromMessage as any).mockResolvedValue('');
    (analyzeAddress as any).mockResolvedValue({ quality: 'not_address' });

    const decision = await decideAddressResume({
      userId: 'user-3',
      message: 'apa kabar layanan desa hari ini',
      pendingAddr: { ...BASE_PENDING },
      channel: 'whatsapp',
    });

    expect(decision.action).toBe('reprompt');
    if (decision.action === 'reprompt') {
      expect(decision.reason).toBe('not_address');
    }
  });

  it('re-prompts on very short replies', async () => {
    (extractAddressFromMessage as any).mockResolvedValue('');
    const decision = await decideAddressResume({
      userId: 'user-4',
      message: 'ok',
      pendingAddr: { ...BASE_PENDING },
      channel: 'whatsapp',
    });

    expect(decision.action).toBe('reprompt');
    if (decision.action === 'reprompt') {
      expect(decision.reason).toBe('too_short');
    }
  });

  it('detects explicit interrupts', async () => {
    const decision = await decideAddressResume({
      userId: 'user-5',
      message: 'batal saja',
      pendingAddr: { ...BASE_PENDING },
      channel: 'whatsapp',
    });

    expect(decision.action).toBe('interrupt');
    if (decision.action === 'interrupt') {
      expect(decision.reason).toBe('explicit_cancel');
    }
  });

  it('treats contact lookup as an interrupt', async () => {
    const decision = await decideAddressResume({
      userId: 'user-6',
      message: 'ada nomor kepala desa?',
      pendingAddr: { ...BASE_PENDING },
      channel: 'whatsapp',
    });

    expect(decision.action).toBe('interrupt');
    if (decision.action === 'interrupt') {
      expect(decision.reason).toBe('contact_directory_interrupt');
    }
  });
});
