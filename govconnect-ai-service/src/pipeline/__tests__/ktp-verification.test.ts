/**
 * Manual KTP verification tests (mocked DB — no Postgres).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../pipeline-store', async (importOriginal) => {
  const orig = await importOriginal<typeof import('../pipeline-store')>();
  return {
    ...orig,
    getDb: vi.fn(),
    appendAudit: vi.fn(async () => true),
    identitySetVerified: vi.fn(async () => true),
  };
});
vi.mock('../doc-reminders', () => ({
  notifyCitizen: vi.fn(async () => true),
}));

import { getDb, identitySetVerified } from '../pipeline-store';
import { notifyCitizen } from '../doc-reminders';
import {
  validateKtpFields, createKtpVerification,
  approveKtpVerification, rejectKtpVerification,
  prefillSlotsFromVerifiedIdentity, KTP_RECEIVED_COPY,
} from '../ktp-verification';

const mockGetDb = vi.mocked(getDb);
const mockSetVerified = vi.mocked(identitySetVerified);
const mockNotify = vi.mocked(notifyCitizen);

function fakeDb(overrides: Record<string, any> = {}) {
  return {
    $queryRawUnsafe: vi.fn(async (..._args: any[]): Promise<any[]> => []),
    $executeRawUnsafe: vi.fn(async (..._args: any[]): Promise<number> => 1),
    ...overrides,
  };
}

const VALID = {
  nik: '3201010101900001', nama: 'Budi Santoso',
  tempat_lahir: 'Bandung', tanggal_lahir: '1990-01-01', alamat: 'Jl. Merdeka 1',
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe('validateKtpFields', () => {
  it('accepts valid fields', () => {
    expect(validateKtpFields(VALID)).toEqual([]);
  });
  it('rejects short NIK', () => {
    expect(validateKtpFields({ ...VALID, nik: '123' }).length).toBeGreaterThan(0);
  });
  it('rejects empty name', () => {
    expect(validateKtpFields({ ...VALID, nama: '' }).length).toBeGreaterThan(0);
  });
  it('rejects bad date format', () => {
    expect(validateKtpFields({ ...VALID, tanggal_lahir: '01-01-1990' }).length).toBeGreaterThan(0);
  });
  it('rejects future birthdate', () => {
    expect(validateKtpFields({ ...VALID, tanggal_lahir: '2099-01-01' }).length).toBeGreaterThan(0);
  });
  it('rejects missing birthdate', () => {
    expect(validateKtpFields({ ...VALID, tanggal_lahir: '' }).length).toBeGreaterThan(0);
  });
});

describe('createKtpVerification', () => {
  it('returns existing pending instead of duplicating', async () => {
    const db = fakeDb({
      $queryRawUnsafe: vi.fn(async () => [{ id: 'existing-id' }]),
    });
    mockGetDb.mockResolvedValue(db as any);
    const r = await createKtpVerification({
      villageId: 'v1', userId: 'u1', photoBytes: Buffer.from('img'),
    });
    expect(r).toEqual({ id: 'existing-id', created: false });
    expect(db.$executeRawUnsafe).not.toHaveBeenCalled();
  });

  it('inserts a new pending request', async () => {
    const db = fakeDb();
    mockGetDb.mockResolvedValue(db as any);
    const r = await createKtpVerification({
      villageId: 'v1', userId: 'u1', photoBytes: Buffer.from('img'),
    });
    expect(r?.created).toBe(true);
    expect(r?.id).toBeTruthy();
    const [sql] = db.$executeRawUnsafe.mock.calls[0];
    expect(sql).toContain('INSERT INTO pipeline_ktp_verifications');
  });

  it('refuses oversized photos', async () => {
    const db = fakeDb();
    mockGetDb.mockResolvedValue(db as any);
    const r = await createKtpVerification({
      villageId: 'v1', userId: 'u1', photoBytes: Buffer.alloc(9 * 1024 * 1024),
    });
    expect(r).toBeNull();
  });
});

describe('approveKtpVerification', () => {
  it('rejects invalid fields without touching the DB state', async () => {
    const db = fakeDb();
    mockGetDb.mockResolvedValue(db as any);
    const r = await approveKtpVerification({
      villageId: 'v1', id: 'k1', reviewedBy: 'admin', fields: { ...VALID, nik: '1' },
    });
    expect(r.ok).toBe(false);
    expect(r.validationErrors!.length).toBeGreaterThan(0);
    expect(db.$executeRawUnsafe).not.toHaveBeenCalled();
    expect(mockSetVerified).not.toHaveBeenCalled();
  });

  it('fails when the request is not pending', async () => {
    const db = fakeDb({ $executeRawUnsafe: vi.fn(async () => 0) });
    mockGetDb.mockResolvedValue(db as any);
    const r = await approveKtpVerification({
      villageId: 'v1', id: 'k1', reviewedBy: 'admin', fields: VALID,
    });
    expect(r).toEqual({ ok: false, error: 'not_pending_or_not_found' });
    expect(mockSetVerified).not.toHaveBeenCalled();
  });

  it('approves: transitions, wipes photo, grants L2, notifies', async () => {
    const db = fakeDb({
      $queryRawUnsafe: vi.fn(async () => [
        { id: 'k1', village_id: 'v1', user_id: 'u1', channel: 'whatsapp', status: 'approved', fields: VALID },
      ]),
    });
    mockGetDb.mockResolvedValue(db as any);
    const r = await approveKtpVerification({
      villageId: 'v1', id: 'k1', reviewedBy: 'admin_desa', fields: VALID,
    });
    expect(r.ok).toBe(true);
    const claimSql = db.$executeRawUnsafe.mock.calls[0][0] as string;
    expect(claimSql).toContain("status = 'pending'");
    const wipeSql = db.$executeRawUnsafe.mock.calls[1][0] as string;
    expect(wipeSql).toContain('photo_bytes = NULL');
    expect(mockSetVerified).toHaveBeenCalledWith('v1', 'u1', 'admin_desa', expect.any(String));
    expect(mockNotify).toHaveBeenCalledWith('v1', 'u1', expect.stringContaining('terverifikasi'));
  });
});

describe('rejectKtpVerification', () => {
  it('requires a reason', async () => {
    const db = fakeDb();
    mockGetDb.mockResolvedValue(db as any);
    const r = await rejectKtpVerification({
      villageId: 'v1', id: 'k1', reviewedBy: 'admin', reason: '   ',
    });
    expect(r).toEqual({ ok: false, error: 'reject_reason_required' });
    expect(db.$executeRawUnsafe).not.toHaveBeenCalled();
  });

  it('rejects: transitions, wipes photo, notifies with reason', async () => {
    const db = fakeDb({
      $queryRawUnsafe: vi.fn(async () => [
        { id: 'k1', village_id: 'v1', user_id: 'u1', channel: 'whatsapp', status: 'rejected', fields: {} },
      ]),
    });
    mockGetDb.mockResolvedValue(db as any);
    const r = await rejectKtpVerification({
      villageId: 'v1', id: 'k1', reviewedBy: 'admin_desa', reason: 'foto blur',
    });
    expect(r.ok).toBe(true);
    expect(mockSetVerified).not.toHaveBeenCalled();
    expect(mockNotify).toHaveBeenCalledWith('v1', 'u1', expect.stringContaining('foto blur'));
  });
});

describe('prefillSlotsFromVerifiedIdentity', () => {
  it('fills only empty slots, never overwrites', () => {
    const slots: Record<string, unknown> = { reporter_name: 'Sudah Ada' };
    const filled = prefillSlotsFromVerifiedIdentity(slots, VALID);
    expect(slots.reporter_name).toBe('Sudah Ada');
    expect(slots.nik).toBe('3201010101900001');
    expect(slots.alamat).toBe('Jl. Merdeka 1');
    expect(filled).toContain('nik');
    expect(filled).not.toContain('reporter_name');
  });
});

describe('copy', () => {
  it('uses the user-decided received copy', () => {
    expect(KTP_RECEIVED_COPY).toContain('petugas desa akan memverifikasi');
  });
});
