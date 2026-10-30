/**
 * W2: instruction prompts must use the `system` role, never `user`.
 */
import { describe, it, expect, vi } from 'vitest';

// ai-gateway.service pulls Prisma transitively; stub the client package and the
// singleton module so the pure message builders test without a live DB.
vi.mock('@prisma/client', () => ({
  PrismaClient: class {
    constructor() {
      return new Proxy(this, {
        get: (t, p) => {
          if (p === 'then') return undefined;
          return (..._args: unknown[]) => Promise.resolve(null);
        },
      });
    }
  },
}));
vi.mock('../../lib/prisma', () => ({
  default: new Proxy({}, { get: () => () => Promise.resolve(null) }),
}));

import { buildPromptMessages, buildUserPromptMessages } from '../ai-gateway.service';

describe('buildPromptMessages (W2)', () => {
  it('sends instruction prompts as system role', () => {
    const msgs = buildPromptMessages('Klasifikasikan pesan berikut...');
    expect(msgs).toHaveLength(1);
    expect(msgs[0].role).toBe('system');
    expect(msgs[0].content).toBe('Klasifikasikan pesan berikut...');
  });

  it('never uses the user role for instructions', () => {
    const msgs = buildPromptMessages('any instruction');
    expect(msgs.some((m) => m.role === 'user')).toBe(false);
  });

  it('buildUserPromptMessages keeps genuine user content as user role', () => {
    const msgs = buildUserPromptMessages('halo, jalan rusak');
    expect(msgs).toHaveLength(1);
    expect(msgs[0].role).toBe('user');
    expect(msgs[0].content).toBe('halo, jalan rusak');
  });
});
