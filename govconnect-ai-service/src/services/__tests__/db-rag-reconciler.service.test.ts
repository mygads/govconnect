import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../important-contacts.service', () => ({
  getImportantContacts: vi.fn(async () => []),
}));

vi.mock('../knowledge.service', () => ({
  getVillageProfileSummary: vi.fn(async () => null),
}));

vi.mock('../case-client.service', () => ({
  getServiceCatalog: vi.fn(async () => []),
}));

import { reconcile } from '../db-rag-reconciler.service';
import { getImportantContacts } from '../important-contacts.service';
import { getVillageProfileSummary } from '../knowledge.service';
import { getServiceCatalog } from '../case-client.service';

function baseResult(overrides: any = {}) {
  return {
    success: true,
    response: 'dummy',
    intent: 'QUESTION',
    metadata: {
      processingTimeMs: 1,
      hasKnowledge: false,
      agentMode: 'single_orchestrator',
      traceId: 'trace-test',
      toolsUsed: [],
    },
    ...overrides,
  };
}

describe('db-rag reconciler', () => {
  beforeEach(() => {
    vi.mocked(getImportantContacts).mockReset();
    vi.mocked(getVillageProfileSummary).mockReset();
    vi.mocked(getServiceCatalog).mockReset();
    vi.mocked(getImportantContacts).mockResolvedValue([] as any);
    vi.mocked(getVillageProfileSummary).mockResolvedValue(null as any);
    vi.mocked(getServiceCatalog).mockResolvedValue([] as any);
  });

  it('rewrites phone numbers that do not exist in the official directory', async () => {
    vi.mocked(getImportantContacts).mockResolvedValue([
      { id: '1', name: 'Damkar', phone: '08110001111' },
    ] as any);

    const decision = await reconcile({
      villageId: 'village-1',
      result: baseResult({
        intent: 'CONTACT_DIRECTORY',
        response: 'Silakan hubungi 08110002222.',
      }),
      toolsUsed: ['get_important_contact'],
    });

    expect(decision.ok).toBe(false);
    expect(decision.mismatches[0]?.kind).toBe('phone_not_in_db');
    expect(decision.replacement?.response || '').toMatch(/daftar kontak resmi desa/i);
  });

  it('flags emergency numbers that are not present in the village directory', async () => {
    vi.mocked(getImportantContacts).mockResolvedValue([
      { id: '1', name: 'Damkar Desa', phone: '08123456789' },
    ] as any);

    const decision = await reconcile({
      villageId: 'village-1',
      result: baseResult({
        intent: 'EMERGENCY_CONTACTS',
        response: 'Untuk darurat silakan hubungi 110.',
      }),
      toolsUsed: ['get_emergency_contacts'],
    });

    expect(decision.ok).toBe(false);
    expect(decision.mismatches[0]?.kind).toBe('phone_not_in_db');
  });

  it('passes through short emergency numbers that exist in the official directory', async () => {
    vi.mocked(getImportantContacts).mockResolvedValue([
      { id: '1', name: 'Polisi Desa', phone: '110' },
    ] as any);

    const decision = await reconcile({
      villageId: 'village-1',
      result: baseResult({
        intent: 'EMERGENCY_CONTACTS',
        response: 'Untuk darurat silakan hubungi 110.',
      }),
      toolsUsed: ['get_emergency_contacts'],
    });

    expect(decision.ok).toBe(true);
    expect(decision.mismatches).toHaveLength(0);
  });

  it('rewrites office phone claims that use a non-office number even if that number exists elsewhere in the village directory', async () => {
    vi.mocked(getImportantContacts).mockResolvedValue([
      { id: '1', name: 'Puskesmas Desa', phone: '08110001111', description: 'Layanan kesehatan' },
      { id: '2', name: 'Admin Pelayanan Kantor Desa', phone: '08110002222', description: 'Nomor kantor utama' },
    ] as any);

    const decision = await reconcile({
      villageId: 'village-1',
      userMessage: 'nomor kantor desa berapa?',
      result: baseResult({
        intent: 'VILLAGE_PROFILE',
        response: 'Nomor kantor desa yang bisa dihubungi adalah 08110001111.',
      }),
      toolsUsed: ['get_village_profile'],
    });

    expect(decision.ok).toBe(false);
    expect(decision.mismatches.some((item) => item.kind === 'phone_not_in_db')).toBe(true);
  });

  it('passes through office phone claims that match an official office contact', async () => {
    vi.mocked(getImportantContacts).mockResolvedValue([
      { id: '1', name: 'Puskesmas Desa', phone: '08110001111', description: 'Layanan kesehatan' },
      { id: '2', name: 'Admin Pelayanan Kantor Desa', phone: '08110002222', description: 'Nomor kantor utama' },
    ] as any);

    const decision = await reconcile({
      villageId: 'village-1',
      userMessage: 'nomor kantor desa berapa?',
      result: baseResult({
        intent: 'VILLAGE_PROFILE',
        response: 'Nomor kantor desa yang bisa dihubungi adalah 08110002222.',
      }),
      toolsUsed: ['get_village_profile'],
    });

    expect(decision.ok).toBe(true);
    expect(decision.mismatches).toHaveLength(0);
  });

  it('rewrites office address claims that do not match the official village profile', async () => {
    vi.mocked(getVillageProfileSummary).mockResolvedValue({
      address: 'Jl. Melati No. 10 RT 01 RW 02',
      operating_hours: '08:00-15:00',
    } as any);

    const decision = await reconcile({
      villageId: 'village-1',
      userMessage: 'kantor desa dimana?',
      result: baseResult({
        intent: 'VILLAGE_PROFILE',
        response: 'Kantor desa berada di Jl. Kenanga No. 5 RT 03 RW 04.',
      }),
      toolsUsed: ['get_village_profile'],
    });

    expect(decision.ok).toBe(false);
    expect(decision.mismatches.some((item) => item.kind === 'office_address_mismatch')).toBe(true);
  });

  it('rewrites service cost claims that do not match the official catalog', async () => {
    vi.mocked(getServiceCatalog).mockResolvedValue([
      {
        id: 'svc-1',
        slug: 'surat-domisili',
        name: 'Surat Keterangan Domisili',
        is_active: true,
        estimated_cost: 'Gratis',
        estimated_processing_time: '2 hari kerja',
      },
    ] as any);

    const decision = await reconcile({
      villageId: 'village-1',
      userMessage: 'biaya surat domisili berapa?',
      result: baseResult({
        intent: 'SERVICE_INFO',
        response: 'Untuk layanan Surat Keterangan Domisili, biayanya Rp 25.000 dan prosesnya 2 hari kerja.',
      }),
      toolsUsed: ['get_service_info'],
    });

    expect(decision.ok).toBe(false);
    expect(decision.mismatches.some((item) => item.kind === 'service_cost_mismatch')).toBe(true);
    expect(decision.replacement?.response || '').toMatch(/katalog resmi desa/i);
  });

  it('rewrites online/offline claims that do not match the official service mode', async () => {
    vi.mocked(getServiceCatalog).mockResolvedValue([
      {
        id: 'svc-1',
        slug: 'surat-domisili',
        name: 'Surat Keterangan Domisili',
        is_active: true,
        mode: 'offline',
      },
    ] as any);

    const decision = await reconcile({
      villageId: 'village-1',
      userMessage: 'surat domisili bisa online kah?',
      result: baseResult({
        intent: 'SERVICE_INFO',
        response: 'Surat Keterangan Domisili bisa diajukan online lewat link formulir.',
      }),
      toolsUsed: ['get_service_info'],
    });

    expect(decision.ok).toBe(false);
    expect(decision.mismatches.some((item) => item.kind === 'service_mode_mismatch')).toBe(true);
  });

  it('rewrites availability claims that contradict the official service active state', async () => {
    vi.mocked(getServiceCatalog).mockResolvedValue([
      {
        id: 'svc-1',
        slug: 'surat-domisili',
        name: 'Surat Keterangan Domisili',
        is_active: false,
      },
    ] as any);

    const decision = await reconcile({
      villageId: 'village-1',
      userMessage: 'surat domisili tersedia?',
      result: baseResult({
        intent: 'SERVICE_INFO',
        response: 'Surat Keterangan Domisili masih tersedia dan bisa diajukan sekarang.',
      }),
      toolsUsed: ['get_service_info'],
    });

    expect(decision.ok).toBe(false);
    expect(decision.mismatches.some((item) => item.kind === 'service_availability_mismatch')).toBe(true);
  });

  it('rewrites requirement claims that contradict documented service requirements', async () => {
    vi.mocked(getServiceCatalog).mockResolvedValue([
      {
        id: 'svc-1',
        slug: 'surat-domisili',
        name: 'Surat Keterangan Domisili',
        is_active: true,
        requirements: [
          { label: 'KTP', is_required: true },
          { label: 'KK', is_required: true },
        ],
      },
    ] as any);

    const decision = await reconcile({
      villageId: 'village-1',
      userMessage: 'syarat surat domisili apa?',
      result: baseResult({
        intent: 'SERVICE_INFO',
        response: 'Syarat Surat Keterangan Domisili tidak ada, cukup datang saja.',
      }),
      toolsUsed: ['get_service_info'],
    });

    expect(decision.ok).toBe(false);
    expect(decision.mismatches.some((item) => item.kind === 'service_requirement_mismatch')).toBe(true);
  });

  it('passes through when the response matches the official profile and service values', async () => {
    vi.mocked(getVillageProfileSummary).mockResolvedValue({
      address: 'Jl. Melati No. 10 RT 01 RW 02',
      operating_hours: '08:00-15:00',
    } as any);
    vi.mocked(getServiceCatalog).mockResolvedValue([
      {
        id: 'svc-1',
        slug: 'surat-domisili',
        name: 'Surat Keterangan Domisili',
        is_active: true,
        estimated_cost: 'Gratis',
        estimated_processing_time: '2 hari kerja',
        mode: 'both',
        requirements: [
          { label: 'KTP', is_required: true },
          { label: 'KK', is_required: true },
        ],
      },
    ] as any);

    const decision = await reconcile({
      villageId: 'village-1',
      userMessage: 'biaya surat domisili berapa?',
      result: baseResult({
        intent: 'SERVICE_INFO',
        response: 'Surat Keterangan Domisili gratis, estimasi prosesnya 2 hari kerja, bisa diajukan online, dan syaratnya KTP serta KK. Kantor desa ada di Jl. Melati No. 10 RT 01 RW 02.',
      }),
      toolsUsed: ['get_service_info', 'get_village_profile'],
    });

    expect(decision.ok).toBe(true);
    expect(decision.mismatches).toHaveLength(0);
  });
});
