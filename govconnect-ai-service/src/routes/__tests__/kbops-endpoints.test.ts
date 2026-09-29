/**
 * A3: admin-facing endpoints — mocked DB/identity store, no Postgres.
 *
 * - GET /api/fallback-tickets: internal-key protected, village_id required,
 *   tenant-scoped (tenant_id = village_id), reason/status filters forwarded.
 * - POST /api/identity/revoke: internal-key protected, calls identityRevoke
 *   with the (village_id, user_id) pair — never cross-tenant.
 */
import { describe, it, expect, vi, beforeEach, afterAll } from 'vitest';
import express, { type Express } from 'express';
import type { AddressInfo } from 'net';

const { fakePrisma, identityRevokeMock } = vi.hoisted(() => {
  const fakePrisma = {
    pipeline_fallback_tickets: {
      count: vi.fn(async (_args?: any): Promise<number> => 0),
      findMany: vi.fn(async (_args?: any): Promise<any[]> => []),
    },
  };
  const identityRevokeMock = vi.fn(async (_tenantId?: string, _userId?: string): Promise<boolean> => true);
  return { fakePrisma, identityRevokeMock };
});

vi.mock('@prisma/client', () => ({
  PrismaClient: vi.fn(() => fakePrisma),
}));

vi.mock('../../utils/internal-auth', () => ({
  internalApiKeyMatches: (v: unknown) => v === 'test-internal-key',
}));

vi.mock('../../pipeline/pipeline-store', async (importOriginal) => {
  const orig = await importOriginal<Record<string, unknown>>();
  return { ...orig, identityRevoke: identityRevokeMock };
});

import fallbackTicketsRoutes from '../fallback-tickets.routes';
import identityRoutes from '../identity.routes';

const INTERNAL_KEY = 'test-internal-key';

async function mount(router: express.Router, base: string): Promise<{ app: Express; baseUrl: string; close: () => void }> {
  const app = express();
  app.use(express.json());
  app.use(base, router);
  const server = app.listen(0, '127.0.0.1');
  await new Promise<void>((resolve) => server.once('listening', resolve));
  const { port } = server.address() as AddressInfo;
  return { app, baseUrl: `http://127.0.0.1:${port}`, close: () => server.close() };
}

let servers: Array<() => void> = [];
afterAll(() => {
  for (const close of servers) close();
  servers = [];
});

beforeEach(() => {
  vi.clearAllMocks();
  fakePrisma.pipeline_fallback_tickets.count.mockResolvedValue(2);
  fakePrisma.pipeline_fallback_tickets.findMany.mockResolvedValue([
    {
      ticket_id: 'T-1', user_id: 'u1', channel: 'whatsapp', stage: 'csat',
      reason: 'csat_low_rating', detail: 'rating 1', status: 'open',
      created_at: new Date('2026-09-29T10:00:00Z'),
    },
    {
      ticket_id: 'T-2', user_id: 'u2', channel: 'whatsapp', stage: 'csat',
      reason: 'csat_low_rating', detail: 'rating 2', status: 'open',
      created_at: new Date('2026-09-29T11:00:00Z'),
    },
  ]);
  identityRevokeMock.mockResolvedValue(true);
});

describe('GET /api/fallback-tickets', () => {
  it('rejects requests without the internal API key', async () => {
    const { baseUrl, close } = await mount(fallbackTicketsRoutes, '/api/fallback-tickets');
    servers.push(close);
    const res = await fetch(`${baseUrl}/api/fallback-tickets?village_id=v1`);
    expect(res.status).toBe(403);
  });

  it('requires village_id', async () => {
    const { baseUrl, close } = await mount(fallbackTicketsRoutes, '/api/fallback-tickets');
    servers.push(close);
    const res = await fetch(`${baseUrl}/api/fallback-tickets`, {
      headers: { 'x-internal-api-key': INTERNAL_KEY },
    });
    expect(res.status).toBe(400);
  });

  it('lists tickets scoped to the tenant with reason filter', async () => {
    const { baseUrl, close } = await mount(fallbackTicketsRoutes, '/api/fallback-tickets');
    servers.push(close);
    const res = await fetch(
      `${baseUrl}/api/fallback-tickets?village_id=v1&reason=csat_low_rating`,
      { headers: { 'x-internal-api-key': INTERNAL_KEY } },
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(body.success).toBe(true);
    expect(body.village_id).toBe('v1');
    expect(body.total).toBe(2);
    expect(body.tickets).toHaveLength(2);
    expect(body.tickets[0].ticket_id).toBe('T-1');

    // Tenant scoping: tenant_id must equal the requested village_id
    const countArgs = fakePrisma.pipeline_fallback_tickets.count.mock.calls[0] as any[];
    const countWhere = (countArgs[0] as any).where;
    expect(countWhere.tenant_id).toBe('v1');
    expect(countWhere.reason).toBe('csat_low_rating');
    expect(countWhere.status).toBe('open');
    const findArgs = fakePrisma.pipeline_fallback_tickets.findMany.mock.calls[0] as any[];
    const findWhere = (findArgs[0] as any).where;
    expect(findWhere.tenant_id).toBe('v1');
  });

  it('never leaks another tenant: where.tenant_id is always the requested village', async () => {
    const { baseUrl, close } = await mount(fallbackTicketsRoutes, '/api/fallback-tickets');
    servers.push(close);
    await fetch(`${baseUrl}/api/fallback-tickets?village_id=other-village&status=all`, {
      headers: { 'x-internal-api-key': INTERNAL_KEY },
    });
    const findArgs = fakePrisma.pipeline_fallback_tickets.findMany.mock.calls[0] as any[];
    const findWhere = (findArgs[0] as any).where;
    expect(findWhere.tenant_id).toBe('other-village');
    expect(findWhere).not.toHaveProperty('status'); // status=all -> no filter
  });
});

describe('POST /api/identity/revoke', () => {
  it('rejects requests without the internal API key', async () => {
    const { baseUrl, close } = await mount(identityRoutes, '/api/identity');
    servers.push(close);
    const res = await fetch(`${baseUrl}/api/identity/revoke`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ village_id: 'v1', user_id: 'u9' }),
    });
    expect(res.status).toBe(403);
    expect(identityRevokeMock).not.toHaveBeenCalled();
  });

  it('requires village_id and user_id', async () => {
    const { baseUrl, close } = await mount(identityRoutes, '/api/identity');
    servers.push(close);
    const res = await fetch(`${baseUrl}/api/identity/revoke`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-internal-api-key': INTERNAL_KEY },
      body: JSON.stringify({ village_id: 'v1' }),
    });
    expect(res.status).toBe(400);
    expect(identityRevokeMock).not.toHaveBeenCalled();
  });

  it('revokes within the given tenant scope', async () => {
    const { baseUrl, close } = await mount(identityRoutes, '/api/identity');
    servers.push(close);
    const res = await fetch(`${baseUrl}/api/identity/revoke`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-internal-api-key': INTERNAL_KEY },
      body: JSON.stringify({ village_id: 'v1', user_id: 'u9' }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(body.success).toBe(true);
    expect(body.village_id).toBe('v1');
    expect(body.user_id).toBe('u9');
    expect(identityRevokeMock).toHaveBeenCalledTimes(1);
    expect(identityRevokeMock).toHaveBeenCalledWith('v1', 'u9');
  });
});
