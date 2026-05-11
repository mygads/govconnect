import test, { afterEach } from 'node:test';
import assert from 'node:assert/strict';
import type { Request, Response } from 'express';
import prisma from '../config/database';
import {
  handleCreateComplaintType,
  handleCreateComplaintUpdate,
  handleUpdateComplaintType,
} from './complaint-meta.controller';

type MockResponse = Response & {
  statusCode?: number;
  jsonBody?: unknown;
};

const restoreFns: Array<() => void> = [];

function stubMethod<T extends object, K extends keyof T>(obj: T, key: K, impl: T[K]) {
  const original = obj[key];
  restoreFns.push(() => {
    (obj as T)[key] = original;
  });
  (obj as T)[key] = impl;
}

function createResponse(): MockResponse {
  const res = {} as MockResponse;
  res.statusCode = 200;
  res.status = ((code: number) => {
    res.statusCode = code;
    return res;
  }) as Response['status'];
  res.json = ((body: unknown) => {
    res.jsonBody = body;
    return res;
  }) as Response['json'];
  return res;
}

function createRequest(overrides: Partial<Request> = {}): Request {
  return {
    body: {},
    headers: {},
    params: {},
    query: {},
    ...overrides,
  } as Request;
}

afterEach(() => {
  while (restoreFns.length > 0) {
    restoreFns.pop()?.();
  }
});

test('handleCreateComplaintType rejects important contact category from another village', async () => {
  let findCategoryCalls = 0;
  let queryRawCalls = 0;
  let createTypeCalls = 0;

  stubMethod(prisma.complaintCategory as any, 'findFirst', async () => {
    findCategoryCalls += 1;
    return {
      id: 'category-1',
      village_id: 'village-1',
    };
  });
  stubMethod(prisma as any, '$queryRaw', async () => {
    queryRawCalls += 1;
    return [];
  });
  stubMethod(prisma.complaintType as any, 'create', async () => {
    createTypeCalls += 1;
    return { id: 'type-1' };
  });

  const req = createRequest({
    body: {
      category_id: 'category-1',
      name: 'Jalan Rusak',
      send_important_contacts: true,
      important_contact_category_id: 'contact-category-other-village',
    },
    headers: {
      'x-admin-role': 'admin',
      'x-village-id': 'village-1',
    },
  });
  const res = createResponse();

  await handleCreateComplaintType(req, res);

  assert.equal(findCategoryCalls, 1);
  assert.equal(queryRawCalls, 1);
  assert.equal(createTypeCalls, 0);
  assert.equal(res.statusCode, 400);
  assert.deepEqual(res.jsonBody, {
    error: 'important contact category tidak valid untuk desa ini',
  });
});

test('handleCreateComplaintType accepts same-village important contact category', async () => {
  let findCategoryCalls = 0;
  let queryRawCalls = 0;
  let createTypeCalls = 0;

  stubMethod(prisma.complaintCategory as any, 'findFirst', async () => {
    findCategoryCalls += 1;
    return {
      id: 'category-1',
      village_id: 'village-1',
    };
  });
  stubMethod(prisma as any, '$queryRaw', async () => {
    queryRawCalls += 1;
    return [{ id: 'contact-category-1', village_id: 'village-1' }];
  });
  stubMethod(prisma.complaintType as any, 'create', async ({ data }: any) => {
    createTypeCalls += 1;
    return {
      id: 'type-1',
      ...data,
    };
  });

  const req = createRequest({
    body: {
      category_id: 'category-1',
      name: 'Jalan Rusak',
      send_important_contacts: true,
      important_contact_category_id: 'contact-category-1',
    },
    headers: {
      'x-admin-role': 'admin',
      'x-village-id': 'village-1',
    },
  });
  const res = createResponse();

  await handleCreateComplaintType(req, res);

  assert.equal(findCategoryCalls, 1);
  assert.equal(queryRawCalls, 1);
  assert.equal(createTypeCalls, 1);
  assert.equal(res.statusCode, 201);
  assert.equal((res.jsonBody as any).data.important_contact_category_id, 'contact-category-1');
});

test('handleUpdateComplaintType rejects replacing important contact category with another village id', async () => {
  let findTypeCalls = 0;
  let queryRawCalls = 0;
  let updateTypeCalls = 0;

  stubMethod(prisma.complaintType as any, 'findFirst', async () => {
    findTypeCalls += 1;
    return {
      id: 'type-1',
      name: 'Jalan Rusak',
      send_important_contacts: true,
      important_contact_category_id: 'contact-category-1',
      is_urgent: false,
      require_address: false,
      category: {
        id: 'category-1',
        village_id: 'village-1',
      },
    };
  });
  stubMethod(prisma as any, '$queryRaw', async () => {
    queryRawCalls += 1;
    return [];
  });
  stubMethod(prisma.complaintType as any, 'update', async () => {
    updateTypeCalls += 1;
    return { id: 'type-1' };
  });

  const req = createRequest({
    body: {
      name: 'Jalan Rusak',
      send_important_contacts: true,
      important_contact_category_id: 'contact-category-other-village',
    },
    params: { id: 'type-1' },
    headers: {
      'x-admin-role': 'admin',
      'x-village-id': 'village-1',
    },
  });
  const res = createResponse();

  await handleUpdateComplaintType(req, res);

  assert.equal(findTypeCalls, 1);
  assert.equal(queryRawCalls, 1);
  assert.equal(updateTypeCalls, 0);
  assert.equal(res.statusCode, 400);
  assert.deepEqual(res.jsonBody, {
    error: 'important contact category tidak valid untuk desa ini',
  });
});

test('handleUpdateComplaintType keeps existing important contact category without revalidating when id is unchanged', async () => {
  let findTypeCalls = 0;
  let queryRawCalls = 0;
  let updateTypeCalls = 0;

  stubMethod(prisma.complaintType as any, 'findFirst', async () => {
    findTypeCalls += 1;
    return {
      id: 'type-1',
      name: 'Jalan Rusak',
      send_important_contacts: true,
      important_contact_category_id: 'contact-category-1',
      is_urgent: false,
      require_address: false,
      category: {
        id: 'category-1',
        village_id: 'village-1',
      },
    };
  });
  stubMethod(prisma as any, '$queryRaw', async () => {
    queryRawCalls += 1;
    throw new Error('should not validate existing id');
  });
  stubMethod(prisma.complaintType as any, 'update', async ({ data }: any) => {
    updateTypeCalls += 1;
    return {
      id: 'type-1',
      ...data,
    };
  });

  const req = createRequest({
    body: {
      name: 'Jalan Rusak Baru',
      send_important_contacts: true,
    },
    params: { id: 'type-1' },
    headers: {
      'x-admin-role': 'admin',
      'x-village-id': 'village-1',
    },
  });
  const res = createResponse();

  await handleUpdateComplaintType(req, res);

  assert.equal(findTypeCalls, 1);
  assert.equal(queryRawCalls, 0);
  assert.equal(updateTypeCalls, 1);
  assert.equal(res.statusCode, 200);
  assert.equal((res.jsonBody as any).data.important_contact_category_id, 'contact-category-1');
});

test('handleCreateComplaintUpdate requires village scope before writing admin notes', async () => {
  let findComplaintCalls = 0;

  stubMethod(prisma.complaint as any, 'findFirst', async () => {
    findComplaintCalls += 1;
    return {
      id: 'complaint-1',
      village_id: 'village-1',
    };
  });

  const req = createRequest({
    body: {
      note_text: 'Sedang diproses.',
    },
    params: { id: 'complaint-1' },
  });
  const res = createResponse();

  await handleCreateComplaintUpdate(req, res);

  assert.equal(findComplaintCalls, 0);
  assert.equal(res.statusCode, 400);
  assert.deepEqual(res.jsonBody, {
    error: 'village_id is required for multi-tenancy isolation',
  });
});

test('handleCreateComplaintUpdate resolves complaint reference within the same village before inserting update', async () => {
  let findComplaintCalls = 0;
  let createUpdateCalls = 0;

  stubMethod(prisma.complaint as any, 'findFirst', async () => {
    findComplaintCalls += 1;
    return {
      id: 'complaint-db-id-1',
      complaint_id: 'LAP-20260101-001',
      village_id: 'village-1',
    };
  });
  stubMethod(prisma.complaintUpdate as any, 'create', async ({ data }: any) => {
    createUpdateCalls += 1;
    return {
      id: 'update-1',
      ...data,
    };
  });

  const req = createRequest({
    body: {
      note_text: 'Sedang diproses.',
    },
    params: { id: 'LAP-20260101-001' },
    query: { village_id: 'village-1' },
  });
  const res = createResponse();

  await handleCreateComplaintUpdate(req, res);

  assert.equal(findComplaintCalls, 1);
  assert.equal(createUpdateCalls, 1);
  assert.equal(res.statusCode, 201);
  assert.equal((res.jsonBody as any).data.complaint_id, 'complaint-db-id-1');
});
