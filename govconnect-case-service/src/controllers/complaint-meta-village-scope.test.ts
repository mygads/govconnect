/**
 * P1-12 — Village scoping tests for complaint categories & types.
 *
 * Rule under test (explicit, fail-closed):
 * - Complaint categories/types are ALWAYS per-village; there are NO global
 *   categories. A query scoped to village A must never return village B rows.
 * - A query without any village scope must be rejected (fail-closed), never
 *   executed unscoped.
 */
import test, { afterEach } from 'node:test';
import assert from 'node:assert/strict';
import type { Request, Response } from 'express';
import prisma from '../config/database';
import {
  handleGetComplaintCategories,
  handleGetComplaintTypes,
} from './complaint-meta.controller';
import { resolveComplaintTypeFromDB } from '../services/complaint.service';

type MockResponse = Response & {
  statusCode?: number;
  jsonBody?: unknown;
};

const restoreFns: Array<() => void> = [];

// ---- Two-village seed (in-memory mock) ----
const CATEGORIES = [
  { id: 'cat-a1', village_id: 'village-a', name: 'Infrastruktur', name_key: 'infrastruktur', description: null, is_active: true },
  { id: 'cat-a2', village_id: 'village-a', name: 'Kebersihan', name_key: 'kebersihan', description: null, is_active: true },
  { id: 'cat-b1', village_id: 'village-b', name: 'Infrastruktur', name_key: 'infrastruktur', description: null, is_active: true },
];
const TYPES = [
  { id: 'type-a1', category_id: 'cat-a1', name: 'Jalan Rusak', category: CATEGORIES[0] },
  { id: 'type-a2', category_id: 'cat-a2', name: 'Sampah Menumpuk', category: CATEGORIES[1] },
  { id: 'type-b1', category_id: 'cat-b1', name: 'Jembatan Rusak', category: CATEGORIES[2] },
];

const findManyCalls: Array<{ model: 'category' | 'type'; args: any }> = [];

function stubMethod<T extends object, K extends keyof T>(obj: T, key: K, impl: T[K]) {
  const original = obj[key];
  restoreFns.push(() => {
    (obj as T)[key] = original;
  });
  (obj as T)[key] = impl;
}

/** Faithful stub: applies the prisma where-clause to the in-memory seed. */
function stubFaithfulFindMany() {
  stubMethod(prisma.complaintCategory as any, 'findMany', async (args: any) => {
    findManyCalls.push({ model: 'category', args });
    const where = args?.where ?? {};
    return CATEGORIES.filter((c) => !where.village_id || c.village_id === where.village_id);
  });
  stubMethod(prisma.complaintType as any, 'findMany', async (args: any) => {
    findManyCalls.push({ model: 'type', args });
    const where = args?.where ?? {};
    return TYPES.filter((t) => {
      if (where.category?.village_id && t.category.village_id !== where.category.village_id) return false;
      if (where.category_id && t.category_id !== where.category_id) return false;
      return true;
    });
  });
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
  findManyCalls.length = 0;
  while (restoreFns.length > 0) {
    restoreFns.pop()?.();
  }
});

// ---------- handleGetComplaintCategories ----------

test('P1-12: categories for village A return only village A rows', async () => {
  stubFaithfulFindMany();
  const req = createRequest({
    headers: { 'x-admin-role': 'village_admin', 'x-village-id': 'village-a' },
    query: { village_id: 'village-a' },
  });
  const res = createResponse();

  await handleGetComplaintCategories(req, res);

  assert.equal(res.statusCode, 200);
  const rows = (res.jsonBody as any).data;
  assert.equal(rows.length, 2);
  assert.ok(rows.every((r: any) => r.village_id === 'village-a'), 'no village-b row may leak');
  const categoryCall = findManyCalls.find((c) => c.model === 'category');
  assert.deepEqual(categoryCall?.args?.where, { village_id: 'village-a' });
});

test('P1-12: types for village A return only village A types', async () => {
  stubFaithfulFindMany();
  const req = createRequest({
    headers: { 'x-admin-role': 'village_admin', 'x-village-id': 'village-a' },
    query: { village_id: 'village-a' },
  });
  const res = createResponse();

  await handleGetComplaintTypes(req, res);

  assert.equal(res.statusCode, 200);
  const rows = (res.jsonBody as any).data;
  assert.equal(rows.length, 2);
  assert.ok(rows.every((r: any) => r.category.village_id === 'village-a'), 'no village-b type may leak');
  const typeCall = findManyCalls.find((c) => c.model === 'type');
  assert.equal(typeCall?.args?.where?.category?.village_id, 'village-a');
});

test('P1-12: village_admin of B querying village A is rejected (403), no query issued', async () => {
  stubFaithfulFindMany();
  const req = createRequest({
    headers: { 'x-admin-role': 'village_admin', 'x-village-id': 'village-b' },
    query: { village_id: 'village-a' },
  });
  const res = createResponse();

  await handleGetComplaintTypes(req, res);

  assert.equal(res.statusCode, 403);
  assert.equal(findManyCalls.length, 0);
});

test('P1-12: village_admin without x-village-id is rejected (400, fail-closed)', async () => {
  stubFaithfulFindMany();
  const req = createRequest({
    headers: { 'x-admin-role': 'village_admin' },
    query: { village_id: 'village-a' },
  });
  const res = createResponse();

  await handleGetComplaintCategories(req, res);

  assert.equal(res.statusCode, 400);
  assert.equal(findManyCalls.length, 0);
});

test('P1-12: request without x-admin-role is rejected (400, fail-closed)', async () => {
  stubFaithfulFindMany();
  const req = createRequest({ query: { village_id: 'village-a' } });
  const res = createResponse();

  await handleGetComplaintCategories(req, res);

  assert.equal(res.statusCode, 400);
  assert.equal(findManyCalls.length, 0);
});

test('P1-12: superadmin without village_id and without scope=all is rejected (400)', async () => {
  stubFaithfulFindMany();
  const req = createRequest({ headers: { 'x-admin-role': 'superadmin' }, query: {} });
  const res = createResponse();

  await handleGetComplaintCategories(req, res);

  assert.equal(res.statusCode, 400);
  assert.equal(findManyCalls.length, 0);
});

test('P1-12: superadmin scope=all is the explicit cross-village aggregate (no village filter)', async () => {
  stubFaithfulFindMany();
  const req = createRequest({
    headers: { 'x-admin-role': 'superadmin' },
    query: { scope: 'all' },
  });
  const res = createResponse();

  await handleGetComplaintCategories(req, res);

  assert.equal(res.statusCode, 200);
  const rows = (res.jsonBody as any).data;
  assert.equal(rows.length, 3, 'superadmin aggregate sees both villages');
  const categoryCall = findManyCalls.find((c) => c.model === 'category');
  assert.ok(!categoryCall?.args?.where?.village_id, 'aggregate view carries no village filter');
});

// ---------- resolveComplaintTypeFromDB ----------

test('P1-12: resolveComplaintTypeFromDB scopes its query to the given village', async () => {
  stubMethod(prisma.complaintType as any, 'findMany', async (args: any) => {
    findManyCalls.push({ model: 'type', args });
    return []; // no rows → returns null before any micro-LLM call
  });

  const result = await resolveComplaintTypeFromDB('jalan rusak', 'village-a');

  assert.equal(result, null);
  assert.equal(findManyCalls.length, 1);
  assert.deepEqual(findManyCalls[0].args?.where, { category: { village_id: 'village-a' } });
});

test('P1-12: resolveComplaintTypeFromDB without village_id returns null and never queries (fail-closed)', async () => {
  stubMethod(prisma.complaintType as any, 'findMany', async (args: any) => {
    findManyCalls.push({ model: 'type', args });
    return TYPES;
  });

  assert.equal(await resolveComplaintTypeFromDB('jalan rusak', ''), null);
  assert.equal(await resolveComplaintTypeFromDB('jalan rusak', undefined as unknown as string), null);
  assert.equal(findManyCalls.length, 0, 'no unscoped query may be issued');
});
