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
vi.mock('../pii-vault', () => ({
  vaultStoreNik: vi.fn(async () => '⟦NIK_aaaabbbbcccc⟧'),
  vaultResolveNik: vi.fn(async () => '3201010101900001'),
  vaultInvalidateNik: vi.fn(async () => undefined),
}));

import { getDb, identitySetVerified, appendAudit } from '../pipeline-store';
import { notifyCitizen } from '../doc-reminders';
import {
  vaultStoreNik, vaultResolveNik, vaultInvalidateNik,
} from '../pii-vault';
import {
  validateKtpFields, createKtpVerification,
  approveKtpVerification, rejectKtpVerification,
  prefillSlotsFromVerifiedIdentity, KTP_RECEIVED_COPY,
  getVerifiedIdentity, resolveKtpNikForReview, ktpVaultScope,
} from '../ktp-verification';

const mockGetDb = vi.mocked(getDb);
const mockSetVerified = vi.mocked(identitySetVerified);
const mockNotify = vi.mocked(notifyCitizen);
const mockAppendAudit = vi.mocked(appendAudit);
const mockVaultStore = vi.mocked(vaultStoreNik);
const mockVaultResolve = vi.mocked(vaultResolveNik);
const mockVaultInvalidate = vi.mocked(vaultInvalidateNik);

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

describe('ktpVaultScope', () => {
  it('scopes tokens to (village_id, user_id)', () => {
    expect(ktpVaultScope('v1', 'u1')).toBe('v1:u1');
    expect(ktpVaultScope('v1', 'u1')).not.toBe(ktpVaultScope('v1', 'u2'));
    expect(ktpVaultScope('v1', 'u1')).not.toBe(ktpVaultScope('v2', 'u1'));
  });
});

describe('approveKtpVerification (vault-backed NIK)', () => {
  it('stores nik_token, never plaintext NIK, scoped to (village, user)', async () => {
    const db = fakeDb({
      $queryRawUnsafe: vi.fn(async () => [
        { id: 'k1', user_id: 'u1', channel: 'whatsapp' },
      ]),
    });
    mockGetDb.mockResolvedValue(db as any);
    const r = await approveKtpVerification({
      villageId: 'v1', id: 'k1', reviewedBy: 'admin', fields: VALID,
    });
    expect(r.ok).toBe(true);
    expect(mockVaultStore).toHaveBeenCalledWith('3201010101900001', 'v1:u1', expect.any(Number));
    const updateCall = db.$executeRawUnsafe.mock.calls[0];
    const jsonArg = updateCall.find(
      (a: any) => typeof a === 'string' && a.includes('nik_token'),
    ) as string;
    expect(jsonArg).toBeTruthy();
    const parsed = JSON.parse(jsonArg);
    expect(parsed.nik_token).toBe('⟦NIK_aaaabbbbcccc⟧');
    expect(parsed.nik).toBeUndefined();
    // No plaintext NIK anywhere in any SQL text or bound arg sent to the DB.
    const allStrings = db.$executeRawUnsafe.mock.calls
      .flat()
      .filter((a: any) => typeof a === 'string') as string[];
    expect(allStrings.length).toBeGreaterThan(0);
    for (const s of allStrings) expect(s).not.toContain('3201010101900001');
  });

  it('mints no vault token when the row is not pending', async () => {
    const db = fakeDb({ $queryRawUnsafe: vi.fn(async () => []) });
    mockGetDb.mockResolvedValue(db as any);
    const r = await approveKtpVerification({
      villageId: 'v1', id: 'k1', reviewedBy: 'admin', fields: VALID,
    });
    expect(r).toEqual({ ok: false, error: 'not_pending_or_not_found' });
    expect(mockVaultStore).not.toHaveBeenCalled();
    expect(db.$executeRawUnsafe).not.toHaveBeenCalled();
  });

  it('invalidates the minted token when the claim loses a race (no orphan)', async () => {
    const db = fakeDb({
      $queryRawUnsafe: vi.fn(async () => [
        { id: 'k1', user_id: 'u1', channel: 'whatsapp' },
      ]),
      $executeRawUnsafe: vi.fn(async () => 0),
    });
    mockGetDb.mockResolvedValue(db as any);
    const r = await approveKtpVerification({
      villageId: 'v1', id: 'k1', reviewedBy: 'admin', fields: VALID,
    });
    expect(r).toEqual({ ok: false, error: 'not_pending_or_not_found' });
    expect(mockVaultInvalidate).toHaveBeenCalledWith('⟦NIK_aaaabbbbcccc⟧', 'v1:u1');
    expect(mockSetVerified).not.toHaveBeenCalled();
    expect(mockNotify).not.toHaveBeenCalled();
  });
});

describe('getVerifiedIdentity (vault)', () => {
  it('resolves nik_token to plaintext for pre-fill without leaking the token', async () => {
    const db = fakeDb({
      $queryRawUnsafe: vi.fn(async () => [
        { fields: { nik_token: '⟦NIK_aaaabbbbcccc⟧', nama: 'Budi', alamat: 'Jl. X' } },
      ]),
    });
    mockGetDb.mockResolvedValue(db as any);
    const ident = await getVerifiedIdentity('v1', 'u1');
    expect(mockVaultResolve).toHaveBeenCalledWith('⟦NIK_aaaabbbbcccc⟧', 'v1:u1');
    expect(ident?.nik).toBe('3201010101900001');
    expect(ident?.nama).toBe('Budi');
    expect((ident as any)?.nik_token).toBeUndefined();
  });

  it('returns identity without NIK when the token expired (graceful)', async () => {
    mockVaultResolve.mockResolvedValueOnce(null);
    const db = fakeDb({
      $queryRawUnsafe: vi.fn(async () => [
        { fields: { nik_token: '⟦NIK_old⟧', nama: 'Budi' } },
      ]),
    });
    mockGetDb.mockResolvedValue(db as any);
    const ident = await getVerifiedIdentity('v1', 'u1');
    expect(ident?.nik).toBeUndefined();
    expect(ident?.nama).toBe('Budi');
  });

  it('supports legacy plaintext rows without touching the vault', async () => {
    const db = fakeDb({
      $queryRawUnsafe: vi.fn(async () => [
        { fields: { nik: '3201010101900001', nama: 'Budi' } },
      ]),
    });
    mockGetDb.mockResolvedValue(db as any);
    const ident = await getVerifiedIdentity('v1', 'u1');
    expect(ident?.nik).toBe('3201010101900001');
    expect(mockVaultResolve).not.toHaveBeenCalled();
  });
});

describe('resolveKtpNikForReview (decrypt-on-view)', () => {
  function decidedRow(fields: Record<string, unknown>) {
    return {
      id: 'k1', village_id: 'v1', user_id: 'u1', channel: 'whatsapp',
      status: 'approved', fields, photo_sha256: '', photo_mime: 'image/jpeg',
      reviewed_by: 'admin', reviewed_at: null, reject_reason: '',
      created_at: '2026-01-01', has_photo: false,
    };
  }

  it('resolves the token and audits who viewed it', async () => {
    const db = fakeDb({
      $queryRawUnsafe: vi.fn(async () => [
        decidedRow({ nik_token: '⟦NIK_aaaabbbbcccc⟧', nama: 'Budi' }),
      ]),
    });
    mockGetDb.mockResolvedValue(db as any);
    const r = await resolveKtpNikForReview({ villageId: 'v1', id: 'k1', reviewedBy: 'admin_desa' });
    expect(r).toEqual({ ok: true, nik: '3201010101900001' });
    expect(mockVaultResolve).toHaveBeenCalledWith('⟦NIK_aaaabbbbcccc⟧', 'v1:u1');
    expect(mockAppendAudit).toHaveBeenCalledWith(expect.objectContaining({
      event: 'ktp_nik_viewed',
      payload: expect.objectContaining({ reviewedBy: 'admin_desa', resolved: true }),
    }));
  });

  it('is graceful when the token expired', async () => {
    mockVaultResolve.mockResolvedValueOnce(null);
    const db = fakeDb({
      $queryRawUnsafe: vi.fn(async () => [decidedRow({ nik_token: '⟦NIK_old⟧' })]),
    });
    mockGetDb.mockResolvedValue(db as any);
    const r = await resolveKtpNikForReview({ villageId: 'v1', id: 'k1', reviewedBy: 'admin_desa' });
    expect(r).toEqual({ ok: true, expired: true });
  });

  it('returns not_found for unknown id', async () => {
    const db = fakeDb({ $queryRawUnsafe: vi.fn(async () => []) });
    mockGetDb.mockResolvedValue(db as any);
    const r = await resolveKtpNikForReview({ villageId: 'v1', id: 'nope', reviewedBy: 'admin' });
    expect(r).toEqual({ ok: false, error: 'not_found' });
  });
});
