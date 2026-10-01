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

vi.mock('../runtime-grounding-mismatch.service', () => ({
  recordRuntimeGroundingMismatches: vi.fn(async () => 0),
}));

import { reconcile } from '../db-rag-reconciler.service';
import { getImportantContacts } from '../important-contacts.service';
import { getVillageProfileSummary } from '../knowledge.service';
import { getServiceCatalog } from '../case-client.service';
import { recordRuntimeGroundingMismatches } from '../runtime-grounding-mismatch.service';

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
    vi.mocked(recordRuntimeGroundingMismatches).mockReset();
    vi.mocked(getImportantContacts).mockResolvedValue([] as any);
    vi.mocked(getVillageProfileSummary).mockResolvedValue(null as any);
    vi.mocked(getServiceCatalog).mockResolvedValue([] as any);
    vi.mocked(recordRuntimeGroundingMismatches).mockResolvedValue(0);
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

  it('persists runtime mismatch records when a response is rewritten', async () => {
    vi.mocked(getImportantContacts).mockResolvedValue([
      { id: '1', name: 'Damkar', phone: '08110001111' },
    ] as any);

    const decision = await reconcile({
      villageId: 'village-1',
      userMessage: 'nomor damkar berapa?',
      result: baseResult({
        intent: 'CONTACT_DIRECTORY',
        response: 'Silakan hubungi 08110002222.',
      }),
      toolsUsed: ['get_important_contact'],
    });

    expect(decision.rewritten).toBe(true);
    expect(recordRuntimeGroundingMismatches).toHaveBeenCalledWith([
      expect.objectContaining({
        villageId: 'village-1',
        traceId: 'trace-test',
        userQuery: 'nomor damkar berapa?',
        responseExcerpt: 'Silakan hubungi 08110002222.',
        toolsUsed: ['get_important_contact'],
        mismatchKind: 'phone_not_in_db',
        offendingValue: '08110002222',
        authoritativeValue: '08110001111',
        entityType: 'important_contact',
      }),
    ]);
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

  describe('KB-vs-DB alignment (DB-first enforcement, no get_service_info call)', () => {
    const domisiliService = {
      id: 'svc-1',
      slug: 'surat-domisili',
      name: 'Surat Keterangan Domisili',
      is_active: true,
      requirements: [
        { label: 'KTP-el', is_required: true },
        { label: 'Kartu Keluarga', is_required: true },
      ],
    };

    it('rewrites a KB-sourced answer whose requirement list conflicts with DB', async () => {
      // Artificial conflict: DB says KTP-el + Kartu Keluarga; the KB answer
      // lists an entirely different set of documents.
      vi.mocked(getServiceCatalog).mockResolvedValue([domisiliService] as any);

      const decision = await reconcile({
        villageId: 'village-1',
        userMessage: 'syarat surat domisili apa aja?',
        result: baseResult({
          intent: 'SERVICE_INFO',
          response:
            'Syarat Surat Keterangan Domisili: 1. Surat pengantar RT/RW 2. Pas foto 4x6 3. Fotokopi buku nikah.',
        }),
        toolsUsed: ['search_knowledge'],
      });

      expect(decision.ok).toBe(false);
      expect(decision.rewritten).toBe(true);
      expect(
        decision.mismatches.some((item) => item.kind === 'service_requirement_mismatch'),
      ).toBe(true);
      const mismatch = decision.mismatches.find((item) => item.kind === 'service_requirement_mismatch')!;
      expect(mismatch.entityType).toBe('service');
      expect(mismatch.entityId).toBe('svc-1');
      // DB value is recorded so admins can see what the official list is.
      expect(mismatch.dbValue).toContain('KTP-el');
      // Conflict is persisted for the admin dashboard (runtime mismatches).
      expect(vi.mocked(recordRuntimeGroundingMismatches)).toHaveBeenCalled();
      // The conflicting KB answer is not served to the user.
      expect(decision.replacement?.response).not.toContain('Surat pengantar RT');
    });

    it('rewrites a KB-sourced "no requirements" claim when DB documents requirements', async () => {
      vi.mocked(getServiceCatalog).mockResolvedValue([domisiliService] as any);

      const decision = await reconcile({
        villageId: 'village-1',
        userMessage: 'syarat surat domisili?',
        result: baseResult({
          intent: 'SERVICE_INFO',
          response: 'Untuk Surat Keterangan Domisili tidak ada syarat, cukup bawa fotokopi KK saja.',
        }),
        toolsUsed: ['search_knowledge'],
      });

      expect(decision.ok).toBe(false);
      expect(
        decision.mismatches.some((item) => item.kind === 'service_requirement_mismatch'),
      ).toBe(true);
    });

    it('passes a KB-sourced answer that matches the DB requirement list', async () => {
      // Consistent case: KB answer happens to agree with DB — no rewrite.
      vi.mocked(getServiceCatalog).mockResolvedValue([domisiliService] as any);

      const decision = await reconcile({
        villageId: 'village-1',
        userMessage: 'syarat surat domisili apa aja?',
        result: baseResult({
          intent: 'SERVICE_INFO',
          response:
            'Syarat Surat Keterangan Domisili: KTP-el dan Kartu Keluarga. Bawa dokumen aslinya ya.',
        }),
        toolsUsed: ['search_knowledge'],
      });

      expect(decision.ok).toBe(true);
      expect(decision.rewritten).toBe(false);
      expect(decision.mismatches).toHaveLength(0);
    });

    it('does not touch KB answers that do not mention requirement documents', async () => {
      // Narrative KB answer without a document list — no false positive.
      vi.mocked(getServiceCatalog).mockResolvedValue([domisiliService] as any);

      const decision = await reconcile({
        villageId: 'village-1',
        userMessage: 'jam buka kantor desa?',
        result: baseResult({
          intent: 'QUESTION',
          response: 'Kantor desa buka Senin sampai Jumat. Datang pagi biasanya lebih sepi.',
        }),
        toolsUsed: ['search_knowledge'],
      });

      expect(decision.ok).toBe(true);
      expect(decision.mismatches).toHaveLength(0);
      expect(vi.mocked(recordRuntimeGroundingMismatches)).not.toHaveBeenCalled();
    });

    it('does not flag KB requirement answers when no service can be matched', async () => {
      // Two unrelated services in the catalog: no unique mention → no check,
      // no false positive.
      vi.mocked(getServiceCatalog).mockResolvedValue([
        { id: 'svc-1', name: 'Surat Keterangan Domisili', is_active: true, requirements: [] },
        { id: 'svc-2', name: 'Surat Keterangan Usaha', is_active: true, requirements: [] },
      ] as any);

      const decision = await reconcile({
        villageId: 'village-1',
        userMessage: 'syarat bikin SIM?',
        result: baseResult({
          intent: 'SERVICE_INFO',
          response: 'Syarat bikin SIM: fotokopi KTP, surat keterangan sehat, dan pas foto.',
        }),
        toolsUsed: ['search_knowledge'],
      });

      expect(decision.ok).toBe(true);
      expect(decision.mismatches).toHaveLength(0);
    });
  });
});

describe('[P1-1] phone strip vs rewrite', () => {
  it('strips unverified phone when user asked about hours (not contact)', async () => {
    const { reconcile } = await import('../db-rag-reconciler.service');
    const { getImportantContacts } = await import('../important-contacts.service');
    const { getVillageProfileSummary } = await import('../knowledge.service');
    const vi = (await import('vitest')).vi;

    vi.mocked(getImportantContacts).mockResolvedValue([
      { name: 'Kepala Desa', phone: '081200000001', description: '', category: { name: 'Pemerintah' } },
    ] as any);
    vi.mocked(getVillageProfileSummary).mockResolvedValue({
      operating_hours: 'Senin-Jumat 08.00-14.00',
    } as any);

    const decision = await reconcile({
      villageId: 'village-1',
      userMessage: 'kantor desa buka jam berapa sampe jam berapa?',
      result: {
        success: true,
        response: 'Kantor desa buka Senin-Jumat jam 08.00-14.00. Hubungi 089999999999 untuk info lebih lanjut.',
        intent: 'KNOWLEDGE_QUERY',
        metadata: { processingTimeMs: 1, hasKnowledge: false, agentMode: 'test', traceId: 't1' },
      } as any,
      toolsUsed: ['get_village_profile'],
    });

    expect(decision.ok).toBe(false);
    const response = decision.replacement?.response || '';
    expect(response).toContain('08.00-14.00');
    expect(response).not.toContain('089999999999');
    expect(response).not.toContain('nomor yang saya sebutkan belum cocok');
  });
});
