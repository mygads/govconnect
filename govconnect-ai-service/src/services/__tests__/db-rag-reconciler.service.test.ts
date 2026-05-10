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
      },
    ] as any);

    const decision = await reconcile({
      villageId: 'village-1',
      userMessage: 'biaya surat domisili berapa?',
      result: baseResult({
        intent: 'SERVICE_INFO',
        response: 'Surat Keterangan Domisili gratis dan estimasi prosesnya 2 hari kerja. Kantor desa ada di Jl. Melati No. 10 RT 01 RW 02.',
      }),
      toolsUsed: ['get_service_info', 'get_village_profile'],
    });

    expect(decision.ok).toBe(true);
    expect(decision.mismatches).toHaveLength(0);
  });
});
