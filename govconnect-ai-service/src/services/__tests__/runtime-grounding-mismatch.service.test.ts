import { beforeEach, describe, expect, it, vi } from 'vitest';

const testState = vi.hoisted(() => {
  const createMany = vi.fn(async ({ data }: any): Promise<any> => ({ count: data.length }));
  const findMany = vi.fn(async (): Promise<any[]> => []);
  const count = vi.fn(async (): Promise<number> => 0);
  const groupBy = vi.fn(async (): Promise<any[]> => []);
  const findUnique = vi.fn(async (): Promise<any> => null);
  const update = vi.fn(async ({ where, data }: any): Promise<any> => ({ id: where.id, ...data }));

  return {
    prismaMock: {
      ai_runtime_grounding_mismatches: {
        createMany,
        findMany,
        count,
        groupBy,
        findUnique,
        update,
      },
    },
    createMany,
    findMany,
    count,
    groupBy,
    findUnique,
    update,
  };
});

vi.mock('../../lib/prisma', () => ({
  default: testState.prismaMock,
}));

import {
  listRuntimeGroundingMismatches,
  recordRuntimeGroundingMismatches,
  summarizeRuntimeGroundingMismatches,
  updateRuntimeGroundingMismatchStatus,
} from '../runtime-grounding-mismatch.service';

describe('runtime-grounding-mismatch service', () => {
  beforeEach(() => {
    testState.createMany.mockClear();
    testState.findMany.mockClear();
    testState.count.mockClear();
    testState.groupBy.mockClear();
    testState.findUnique.mockClear();
    testState.update.mockClear();
    testState.findMany.mockResolvedValue([]);
    testState.count.mockResolvedValue(0);
    testState.groupBy.mockResolvedValue([]);
    testState.findUnique.mockResolvedValue(null);
    testState.update.mockImplementation(async ({ where, data }: any) => ({ id: where.id, ...data }));
  });

  it('persists runtime mismatch rows with normalized fields', async () => {
    const inserted = await recordRuntimeGroundingMismatches([
      {
        villageId: 'village-1',
        traceId: 'trace-1',
        userQuery: 'Nomor damkar?',
        responseExcerpt: 'Hubungi 08110002222 sekarang.',
        toolsUsed: ['get_important_contact'],
        mismatchKind: 'phone_not_in_db',
        offendingValue: '08110002222',
        authoritativeValue: '08110001111',
        entityType: 'important_contact',
        entityId: 'contact-1',
      },
    ]);

    expect(inserted).toBe(1);
    expect(testState.createMany).toHaveBeenCalledWith({
      data: [
        expect.objectContaining({
          village_id: 'village-1',
          trace_id: 'trace-1',
          user_query: 'Nomor damkar?',
          response_excerpt: 'Hubungi 08110002222 sekarang.',
          tools_used_json: ['get_important_contact'],
          mismatch_kind: 'phone_not_in_db',
          offending_value: '08110002222',
          authoritative_value: '08110001111',
          entity_type: 'important_contact',
          entity_id: 'contact-1',
          status: 'open',
        }),
      ],
    });
  });

  it('lists runtime mismatches with scoped filters', async () => {
    testState.findMany.mockResolvedValue([{ id: 'row-1' }]);
    testState.count.mockResolvedValue(1);

    const result = await listRuntimeGroundingMismatches({
      villageId: 'village-1',
      kind: 'service_mode_mismatch',
      status: 'open',
      entityType: 'service',
      traceId: 'trace-1',
      limit: 25,
      offset: 5,
    });

    expect(result).toEqual({ items: [{ id: 'row-1' }], total: 1 });
    expect(testState.findMany).toHaveBeenCalledWith({
      where: {
        village_id: 'village-1',
        mismatch_kind: 'service_mode_mismatch',
        status: 'open',
        entity_type: 'service',
        trace_id: 'trace-1',
      },
      orderBy: { detected_at: 'desc' },
      take: 25,
      skip: 5,
    });
  });

  it('summarizes runtime mismatches by kind, status, and entity type', async () => {
    testState.groupBy.mockResolvedValue([
      { mismatch_kind: 'phone_not_in_db', status: 'open', entity_type: 'important_contact', _count: { _all: 2 } },
      { mismatch_kind: 'service_mode_mismatch', status: 'resolved', entity_type: 'service', _count: { _all: 1 } },
    ]);

    const summary = await summarizeRuntimeGroundingMismatches('village-1');

    expect(summary).toEqual({
      total: 3,
      byKind: {
        phone_not_in_db: 2,
        service_mode_mismatch: 1,
      },
      byStatus: {
        open: 2,
        resolved: 1,
      },
      byEntityType: {
        important_contact: 2,
        service: 1,
      },
    });
  });

  it('updates runtime mismatch status with village scoping', async () => {
    testState.findUnique.mockResolvedValue({ id: 'row-1', village_id: 'village-1' });

    await updateRuntimeGroundingMismatchStatus(
      'row-1',
      { status: 'resolved', resolvedBy: 'admin-1', resolutionNote: 'Sudah diverifikasi' },
      'village-1',
    );

    expect(testState.update).toHaveBeenCalledWith({
      where: { id: 'row-1' },
      data: expect.objectContaining({
        status: 'resolved',
        resolved_by: 'admin-1',
        resolution_note: 'Sudah diverifikasi',
      }),
    });
  });
});
