/**
 * R6 — canary docs + token/secret leak detector tests.
 *
 * - Pure: token format, candidate extraction, token scan, secret scanner.
 * - DB-backed (mocked prisma): outbound tripwire audit + fail-soft,
 *   ingest foreign-canary check.
 *
 * The suite asserts the never-log-secrets invariant: finding payloads and
 * audit events carry KINDS/LABELS only — never the secret or token value.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../lib/prisma', () => ({
  default: { $queryRawUnsafe: vi.fn(), $executeRawUnsafe: vi.fn() },
}));
vi.mock('../../pipeline/pipeline-store', () => ({
  appendAudit: vi.fn(async () => true),
}));

import {
  generateCanaryToken,
  extractCanaryCandidates,
  scanTextForTokens,
  scanForSecrets,
  checkOutboundForCanary,
  checkIngestForForeignCanary,
  invalidateCanaryCache,
  CANARY_SAFE_REPLY,
} from '../canary-docs';
import prisma from '../../lib/prisma';
import { appendAudit } from '../../pipeline/pipeline-store';

const mockQuery = vi.mocked(prisma.$queryRawUnsafe);
const mockAudit = vi.mocked(appendAudit);

beforeEach(() => {
  vi.clearAllMocks();
});

describe('canary token format', () => {
  it('generates cnry_ + 20 lowercase alphanumerics', () => {
    for (let i = 0; i < 50; i++) {
      expect(generateCanaryToken()).toMatch(/^cnry_[a-z0-9]{20}$/);
    }
  });

  it('generates unique tokens', () => {
    const set = new Set(Array.from({ length: 100 }, generateCanaryToken));
    expect(set.size).toBe(100);
  });
});

describe('extractCanaryCandidates', () => {
  it('extracts and dedupes canary-shaped tokens', () => {
    const a = generateCanaryToken();
    const b = generateCanaryToken();
    const out = extractCanaryCandidates(`see ${a} and ${b} and ${a} again`);
    expect(out.sort()).toEqual([a, b].sort());
  });

  it('ignores non-canary text', () => {
    expect(extractCanaryCandidates('tidak ada token di sini cnry_pendek')).toEqual([]);
  });
});

describe('scanTextForTokens', () => {
  it('matches a planted token verbatim', () => {
    const tok = generateCanaryToken();
    expect(scanTextForTokens(`jawaban: ${tok}`, [tok])).toEqual([tok]);
  });

  it('does not match other villages\u2019 tokens', () => {
    const own = generateCanaryToken();
    const other = generateCanaryToken();
    expect(scanTextForTokens(`jawaban: ${other}`, [own])).toEqual([]);
  });
});

describe('scanForSecrets', () => {
  it('flags AWS access keys', () => {
    const f = scanForSecrets('key = AKIAIOSFODNN7EXAMPLE please');
    expect(f).toEqual([{ kind: 'aws_access_key', count: 1 }]);
  });

  it('flags OpenAI-style keys', () => {
    const f = scanForSecrets('OPENAI sk-abcDEF1234567890xyzQRS');
    expect(f.some((x) => x.kind === 'openai_api_key')).toBe(true);
  });

  it('flags private key headers', () => {
    const f = scanForSecrets('-----BEGIN RSA PRIVATE KEY-----\nMIIB...');
    expect(f.some((x) => x.kind === 'private_key')).toBe(true);
  });

  it('flags credentialed connection strings', () => {
    const f = scanForSecrets('postgres://admin:s3cr3t-pass@db.internal:5432/app');
    expect(f.some((x) => x.kind === 'connection_string')).toBe(true);
  });

  it('flags explicit key assignments', () => {
    const f = scanForSecrets('api_key = "abcdef1234567890"');
    expect(f.some((x) => x.kind === 'assigned_secret')).toBe(true);
  });

  it('does NOT flag ordinary Indonesian prose about passwords', () => {
    const f = scanForSecrets(
      'Untuk reset kata sandi, datang ke kantor desa dengan membawa KTP. ' +
        'Jangan berikan kata sandi Anda kepada siapapun.',
    );
    expect(f).toEqual([]);
  });

  it('never includes the secret value in findings', () => {
    const secret = 'AKIAIOSFODNN7EXAMPLE';
    const f = scanForSecrets(`key ${secret}`);
    expect(JSON.stringify(f)).not.toContain(secret);
  });
});

describe('checkOutboundForCanary', () => {
  const TOK = generateCanaryToken();

  it('detects a leaked token and audits LABELS only', async () => {
    mockQuery.mockResolvedValue([{ id: 'c1', token: TOK, label: 'ops-manual' }]);
    const res = await checkOutboundForCanary(`berikut info: ${TOK}`, 'v1', 't1');
    expect(res).toEqual({ leaked: true, labels: ['ops-manual'] });
    expect(mockAudit).toHaveBeenCalledTimes(1);
    const payload = mockAudit.mock.calls[0][0].payload as Record<string, unknown>;
    expect(payload.labels).toEqual(['ops-manual']);
    // The token value must never land in the audit trail.
    expect(JSON.stringify(mockAudit.mock.calls[0][0])).not.toContain(TOK);
  });

  it('passes clean responses without auditing', async () => {
    mockQuery.mockResolvedValue([{ id: 'c1', token: TOK, label: 'ops-manual' }]);
    const res = await checkOutboundForCanary('Jadwal pelayanan Senin–Jumat.', 'v1', 't1');
    expect(res).toEqual({ leaked: false, labels: [] });
    expect(mockAudit).not.toHaveBeenCalled();
  });

  it('fail-soft on DB error (never blocks the reply)', async () => {
    invalidateCanaryCache('v1'); // drop the list cached by the earlier test
    mockQuery.mockRejectedValue(new Error('db down'));
    const res = await checkOutboundForCanary(`berikut info: ${TOK}`, 'v1', 't1');
    expect(res.leaked).toBe(false);
  });
});

describe('checkIngestForForeignCanary', () => {
  const OWN = generateCanaryToken();
  const FOREIGN = generateCanaryToken();

  it('flags a document carrying another village\u2019s canary', async () => {
    mockQuery.mockResolvedValue([{ village_id: 'v-other', label: 'ops-manual' }]);
    const res = await checkIngestForForeignCanary(`dokumen ${FOREIGN}`, 'v1');
    expect(res.foreignCanary).toEqual({ ownerVillageId: 'v-other', label: 'ops-manual' });
  });

  it('allows a village\u2019s own canary document', async () => {
    mockQuery.mockResolvedValue([{ village_id: 'v1', label: 'sendiri' }]);
    const res = await checkIngestForForeignCanary(`dokumen ${OWN}`, 'v1');
    expect(res.foreignCanary).toBeNull();
  });

  it('allows documents without any canary candidate (no DB hit)', async () => {
    const res = await checkIngestForForeignCanary('dokumen biasa tanpa token', 'v1');
    expect(res.foreignCanary).toBeNull();
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it('fail-soft on DB error', async () => {
    mockQuery.mockRejectedValue(new Error('db down'));
    const res = await checkIngestForForeignCanary(`dokumen ${FOREIGN}`, 'v1');
    expect(res.foreignCanary).toBeNull();
  });
});

describe('CANARY_SAFE_REPLY', () => {
  it('is non-empty and contains no canary token', () => {
    expect(CANARY_SAFE_REPLY.length).toBeGreaterThan(20);
    expect(extractCanaryCandidates(CANARY_SAFE_REPLY)).toEqual([]);
  });
});
