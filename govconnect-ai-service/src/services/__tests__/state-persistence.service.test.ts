import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const testState = vi.hoisted(() => {
  const conversationSessions = new Map<string, {
    wa_user_id: string;
    session_key: string;
    state_json: string;
    expires_at: Date;
  }>();
  const buildSessionKey = (waUserId: string, sessionKey: string) => `${waUserId}:${sessionKey}`;

  const prismaMock = {
    conversation_sessions: {
      upsert: vi.fn(async ({ where, update, create }: any) => {
        const compositeKey = buildSessionKey(
          where.wa_user_id_session_key.wa_user_id,
          where.wa_user_id_session_key.session_key,
        );
        const existing = conversationSessions.get(compositeKey);
        const nextValue = existing
          ? { ...existing, ...update }
          : { ...create };
        conversationSessions.set(compositeKey, nextValue);
        return nextValue;
      }),
      findUnique: vi.fn(async ({ where }: any) => {
        const compositeKey = buildSessionKey(
          where.wa_user_id_session_key.wa_user_id,
          where.wa_user_id_session_key.session_key,
        );
        return conversationSessions.get(compositeKey) ?? null;
      }),
      delete: vi.fn(async ({ where }: any) => {
        const compositeKey = buildSessionKey(
          where.wa_user_id_session_key.wa_user_id,
          where.wa_user_id_session_key.session_key,
        );
        const existing = conversationSessions.get(compositeKey);
        if (!existing) throw new Error('Not found');
        conversationSessions.delete(compositeKey);
        return existing;
      }),
      deleteMany: vi.fn(async ({ where }: any = {}) => {
        let deletedCount = 0;
        for (const [compositeKey, session] of conversationSessions.entries()) {
          const matchesUser = !where?.wa_user_id || session.wa_user_id === where.wa_user_id;
          const matchesExpiry = !where?.expires_at?.lt || session.expires_at < where.expires_at.lt;
          if (matchesUser && matchesExpiry) {
            conversationSessions.delete(compositeKey);
            deletedCount += 1;
          }
        }
        return { count: deletedCount };
      }),
    },
  };

  return { conversationSessions, prismaMock, buildSessionKey };
});

vi.mock('../../lib/prisma', () => ({
  default: testState.prismaMock,
}));

vi.mock('../../utils/logger', () => ({
  default: {
    warn: vi.fn(),
    debug: vi.fn(),
  },
}));

vi.mock('../../utils/timer-registry', () => ({
  registerInterval: vi.fn(),
}));

import { __test_only__, deleteState, loadState, persistState } from '../state-persistence.service';

describe('state persistence debounce', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    testState.conversationSessions.clear();
    __test_only__.resetBufferedStateForTests();
  });

  afterEach(() => {
    __test_only__.resetBufferedStateForTests();
    vi.useRealTimers();
  });

  it('coalesces repeated writes for the same state key', async () => {
    persistState('user-1', 'activeServiceInfo', { slug: 'first' });
    persistState('user-1', 'activeServiceInfo', { slug: 'second' });

    expect(testState.prismaMock.conversation_sessions.upsert).not.toHaveBeenCalled();
    expect(__test_only__.getBufferedStateCount()).toBe(1);

    await vi.advanceTimersByTimeAsync(__test_only__.STATE_PERSIST_DEBOUNCE_MS);

    expect(testState.prismaMock.conversation_sessions.upsert).toHaveBeenCalledTimes(1);
    expect(testState.conversationSessions.get(testState.buildSessionKey('user-1', 'activeServiceInfo'))?.state_json)
      .toBe(JSON.stringify({ slug: 'second' }));
    expect(__test_only__.getBufferedStateCount()).toBe(0);
  });

  it('cancels a buffered write when the state is deleted before flush', async () => {
    persistState('user-1', 'pendingServiceFormOffer', { service_slug: 'surat-domisili' });
    deleteState('user-1', 'pendingServiceFormOffer');

    await vi.advanceTimersByTimeAsync(__test_only__.STATE_PERSIST_DEBOUNCE_MS);

    expect(testState.prismaMock.conversation_sessions.upsert).not.toHaveBeenCalled();
    expect(testState.prismaMock.conversation_sessions.delete).toHaveBeenCalledTimes(1);
    expect(__test_only__.getBufferedStateCount()).toBe(0);
  });

  it('returns the buffered value before the debounce flush reaches the database', async () => {
    persistState('user-1', 'pendingServiceClarification', { original_query: 'surat', timestamp: 1 });

    const loaded = await loadState<{ original_query: string; timestamp: number }>('user-1', 'pendingServiceClarification');

    expect(loaded).toEqual({ original_query: 'surat', timestamp: 1 });
    expect(testState.prismaMock.conversation_sessions.findUnique).not.toHaveBeenCalled();
  });
});
