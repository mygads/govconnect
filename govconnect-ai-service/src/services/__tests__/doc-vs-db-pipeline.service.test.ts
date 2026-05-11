import { beforeEach, describe, expect, it, vi } from 'vitest';

const testState = vi.hoisted(() => {
  const queryRawUnsafe = vi.fn(async () => [] as any[]);
  const getImportantContacts = vi.fn(async () => [] as any[]);
  const getVillageProfileSummary = vi.fn(async () => null as any);
  const getServiceCatalog = vi.fn(async () => [] as any[]);
  const extractEntities = vi.fn(async () => [] as any[]);
  const recordInconsistency = vi.fn(async () => 'inc-1');

  return {
    prismaMock: {
      $queryRawUnsafe: queryRawUnsafe,
    },
    queryRawUnsafe,
    getImportantContacts,
    getVillageProfileSummary,
    getServiceCatalog,
    extractEntities,
    recordInconsistency,
  };
});

vi.mock('../../lib/prisma', () => ({
  default: testState.prismaMock,
}));

vi.mock('../important-contacts.service', () => ({
  getImportantContacts: testState.getImportantContacts,
}));

vi.mock('../knowledge.service', () => ({
  getVillageProfileSummary: testState.getVillageProfileSummary,
}));

vi.mock('../case-client.service', () => ({
  getServiceCatalog: testState.getServiceCatalog,
}));

vi.mock('../consistency-entity-extractor.service', () => ({
  extractEntities: testState.extractEntities,
}));

vi.mock('../knowledge-consistency.service', () => ({
  recordInconsistency: testState.recordInconsistency,
}));

import { runDocVsDbForDocument } from '../doc-vs-db-pipeline.service';

function setSingleChunk(content: string, overrides: Partial<Record<string, unknown>> = {}) {
  testState.queryRawUnsafe.mockResolvedValue([
    {
      id: 'chunk-1',
      document_id: 'doc-1',
      village_id: 'village-1',
      content,
      document_title: 'Panduan Surat Keterangan Domisili',
      section_title: 'Layanan Surat Keterangan Domisili',
      ...overrides,
    },
  ]);
}

describe('doc-vs-db pipeline service', () => {
  beforeEach(() => {
    testState.queryRawUnsafe.mockReset();
    testState.getImportantContacts.mockReset();
    testState.getVillageProfileSummary.mockReset();
    testState.getServiceCatalog.mockReset();
    testState.extractEntities.mockReset();
    testState.recordInconsistency.mockReset();

    testState.queryRawUnsafe.mockResolvedValue([]);
    testState.getImportantContacts.mockResolvedValue([]);
    testState.getVillageProfileSummary.mockResolvedValue(null);
    testState.getServiceCatalog.mockResolvedValue([]);
    testState.extractEntities.mockResolvedValue([]);
    testState.recordInconsistency.mockResolvedValue('inc-1');
  });

  it('records a service cost mismatch against the official catalog', async () => {
    setSingleChunk('Layanan Surat Keterangan Domisili dikenakan biaya Rp 25.000.');
    testState.getServiceCatalog.mockResolvedValue([
      {
        id: 'svc-1',
        name: 'Surat Keterangan Domisili',
        slug: 'surat-domisili',
        is_active: true,
        estimated_cost: 'Gratis',
        estimated_processing_time: '2 hari kerja',
        mode: 'offline',
        requirements: [],
      },
    ]);
    testState.extractEntities.mockResolvedValue([
      { kind: 'service_cost', value: 'Rp 25.000', confidence: 0.9, source: 'regex' },
    ]);

    const mismatches = await runDocVsDbForDocument({
      documentId: 'doc-1',
      villageId: 'village-1',
      allowLlm: false,
    });

    expect(mismatches).toBe(1);
    expect(testState.recordInconsistency).toHaveBeenCalledWith(expect.objectContaining({
      villageId: 'village-1',
      topicHint: 'service_cost',
      sourceBId: 'svc-1',
      sourceBType: 'db_service',
    }));
  });

  it('records a no-requirements claim when the official service still requires documents', async () => {
    setSingleChunk('Untuk Surat Keterangan Domisili tidak ada syarat, cukup datang saja.');
    testState.getServiceCatalog.mockResolvedValue([
      {
        id: 'svc-1',
        name: 'Surat Keterangan Domisili',
        slug: 'surat-domisili',
        is_active: true,
        requirements: [
          { id: 'req-1', label: 'KTP', is_required: true },
          { id: 'req-2', label: 'KK', is_required: true },
        ],
      },
    ]);
    testState.extractEntities.mockResolvedValue([]);

    const mismatches = await runDocVsDbForDocument({
      documentId: 'doc-1',
      villageId: 'village-1',
      allowLlm: false,
    });

    expect(mismatches).toBe(1);
    expect(testState.recordInconsistency).toHaveBeenCalledWith(expect.objectContaining({
      villageId: 'village-1',
      topicHint: 'service_requirement',
      sourceBId: 'svc-1',
    }));
  });

  it('does not flag matching service facts from the same official service', async () => {
    setSingleChunk('Surat Keterangan Domisili gratis, estimasi 2 hari kerja, bisa diajukan online, dan syaratnya KTP.');
    testState.getServiceCatalog.mockResolvedValue([
      {
        id: 'svc-1',
        name: 'Surat Keterangan Domisili',
        slug: 'surat-domisili',
        is_active: true,
        estimated_cost: 'Gratis',
        estimated_processing_time: '2 hari kerja',
        mode: 'both',
        requirements: [
          { id: 'req-1', label: 'KTP', is_required: true },
          { id: 'req-2', label: 'KK', is_required: true },
        ],
      },
    ]);
    testState.extractEntities.mockResolvedValue([
      { kind: 'service_cost', value: 'Gratis', confidence: 0.9, source: 'regex' },
      { kind: 'service_duration', value: '2 hari kerja', confidence: 0.85, source: 'regex' },
      { kind: 'service_mode', value: 'online', confidence: 0.8, source: 'regex' },
      { kind: 'service_requirement_item', value: 'KTP', confidence: 0.8, source: 'regex' },
    ]);

    const mismatches = await runDocVsDbForDocument({
      documentId: 'doc-1',
      villageId: 'village-1',
      allowLlm: false,
    });

    expect(mismatches).toBe(0);
    expect(testState.recordInconsistency).not.toHaveBeenCalled();
  });

  it('requires an explicit service mention before attaching service facts to the catalog', async () => {
    setSingleChunk('Biaya administrasi desa gratis.', {
      document_title: 'Informasi Umum Desa',
      section_title: 'Pengumuman Umum',
    });
    testState.getServiceCatalog.mockResolvedValue([
      {
        id: 'svc-1',
        name: 'Surat Keterangan Domisili',
        slug: 'surat-domisili',
        is_active: true,
        estimated_cost: 'Rp 15.000',
      },
    ]);
    testState.extractEntities.mockResolvedValue([
      { kind: 'service_cost', value: 'Gratis', confidence: 0.9, source: 'regex' },
    ]);

    const mismatches = await runDocVsDbForDocument({
      documentId: 'doc-1',
      villageId: 'village-1',
      allowLlm: false,
    });

    expect(mismatches).toBe(0);
    expect(testState.recordInconsistency).not.toHaveBeenCalled();
  });
});
