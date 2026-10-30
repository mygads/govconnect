/**
 * Smart features — E2E tests (route/pipeline level).
 *
 * DB di-fake in-memory di belakang `vi.mock('@prisma/client')` (pola yang sama
 * dengan src/routes/__tests__/kbops-endpoints.test.ts). Alur yang diuji tetap
 * end-to-end: HTTP → route → service → lapisan DB, atau kontrak 2-turn
 * pipeline yang sesungguhnya — bukan unit terisolasi.
 *
 *  a. Improvement loop: recordFailure() (dipanggil dari titik failure yang
 *     sudah ada, mis. fallback-policy) → POST /api/internal/improvement/analyze
 *     → pola teragregasi + saran perbaikan muncul.
 *  b. Cross-session memory: saveSessionSummary() → "sesi baru"
 *     (hanya wa_user_id yang sama) → buildLastInteractionContext()
 *     → konteks lama ter-inject ke prompt, PII ter-redact.
 *  c. Proactive followup: seed laporan stale >3 hari →
 *     GET /api/internal/followup/candidates → masuk kandidat,
 *     TIDAK ada pengiriman otomatis.
 *  d. Confidence clarification: confidence 0.45 → pertanyaan klarifikasi
 *     SPESIFIK dengan opsi (a)/(b) (replikas sekuens pipeline
 *     process-message-v2.ts:726-731), turn-2 parseClarificationAnswer()
 *     me-routing jawaban user ke stage yang benar.
 *
 * BUG yang ditemukan & diperbaiki saat menulis test ini:
 *  hybrid-memory.service.ts OPERATIONAL_MEMORY_TYPES tidak memuat
 *  'session_summary', sehingga saveSessionSummary() tidak pernah bisa dibaca
 *  kembali oleh getLastInteraction() (filter memory_type di
 *  searchUserMemories mengecualikannya) — alur cross-session memory putus.
 */

import { describe, it, expect, vi, beforeEach, afterAll } from 'vitest';
import express, { type Express } from 'express';
import type { AddressInfo } from 'net';

// ---------------------------------------------------------------------------
// Fake DB in-memory (menggantikan Postgres; semantik SQL di-mirror jujur)
// ---------------------------------------------------------------------------

interface FailureRow {
  id: string;
  village_id: string;
  session_id: string;
  user_message: string;
  failure_type: string;
  stage: string | null;
  intent: string | null;
  created_at: Date;
}

interface MemoryRow {
  id: string;
  wa_user_id: string;
  village_id: string | null;
  memory_type: string;
  memory_key: string | null;
  content: string;
  importance: number;
  created_at: Date;
  metadata_json: unknown;
  last_accessed_at: Date | null;
}

interface ComplaintRow {
  id: string;
  complaint_id: string;
  wa_user_id: string | null;
  village_id: string;
  kategori: string;
  deskripsi: string;
  rt_rw: string | null;
  reporter_name: string | null;
  status: string;
  created_at: Date;
  updated_at: Date;
  deleted_at: Date | null;
}

const { store, fakePrisma, PrismaMock } = vi.hoisted(() => {
  const store: {
    failures: FailureRow[];
    memories: MemoryRow[];
    complaints: ComplaintRow[];
  } = { failures: [], memories: [], complaints: [] };

  type SqlLike = { strings: string[]; values: unknown[] };
  const isSqlInstance = (s: unknown): s is SqlLike => {
    const o = s as { strings?: unknown; values?: unknown } | null;
    return !!o && Array.isArray(o.strings) && Array.isArray(o.values);
  };

  /**
   * Normalisasi argumen $executeRaw/$queryRaw menjadi { text, values }.
   * Prisma menerima dua bentuk:
   *  1. Template-tag: prisma.$queryRaw`...${v}...` → (TemplateStringsArray, ...values)
   *  2. Prisma.sql`...` (bisa bersarang di dalam bentuk 1).
   */
  const flatten = (strings: string[], vals: unknown[]): { text: string; values: unknown[] } => {
    const parts: string[] = [];
    const values: unknown[] = [];
    strings.forEach((part, i) => {
      parts.push(part);
      if (i < vals.length) {
        const v = vals[i];
        if (isSqlInstance(v)) {
          const nested = flatten(v.strings, v.values);
          parts.push(nested.text);
          values.push(...nested.values);
        } else {
          parts.push('?');
          values.push(v);
        }
      }
    });
    return { text: parts.join(''), values };
  };

  const sqlOf = (sql: unknown, rest: unknown[]): { text: string; values: unknown[] } => {
    if (isSqlInstance(sql)) return flatten(sql.strings, sql.values);
    return flatten(Array.isArray(sql) ? (sql as string[]) : [String(sql ?? '')], rest);
  };

  const fakePrisma = {
    $connect: vi.fn(async (): Promise<void> => {}),
    $executeRaw: vi.fn(async (sql: unknown, ...rest: unknown[]): Promise<number> => {
      const { text, values } = sqlOf(sql, rest);
      if (/CREATE TABLE|CREATE INDEX/i.test(text)) return 0; // ensureTable: no-op
      if (/INSERT INTO/i.test(text) && /conversation_failures/i.test(text)) {
        const [id, village_id, session_id, user_message, failure_type, stage, intent] =
          values as [string, string, string, string, string, string | null, string | null];
        store.failures.push({
          id, village_id, session_id, user_message, failure_type, stage, intent,
          created_at: new Date(),
        });
        return 1;
      }
      return 0;
    }),
    $queryRaw: vi.fn(async (sql: unknown, ...rest: unknown[]): Promise<unknown[]> => {
      const { text, values } = sqlOf(sql, rest);

      // --- analyzeFailures: GROUP BY (failure_type, stage), filter village + window hari
      if (/conversation_failures/i.test(text)) {
        const [villageId, days] = values as [string, number];
        const cutoff = Date.now() - Number(days) * 86_400_000;
        const groups = new Map<string, FailureRow[]>();
        for (const f of store.failures) {
          if (f.village_id !== villageId) continue;
          if (f.created_at.getTime() < cutoff) continue;
          const key = `${f.failure_type}|||${f.stage ?? ''}`;
          const g = groups.get(key) ?? [];
          g.push(f);
          groups.set(key, g);
        }
        return [...groups.values()]
          .map((rows) => {
            const sorted = [...rows].sort(
              (a, b) => b.created_at.getTime() - a.created_at.getTime(),
            );
            const times = rows.map((r) => r.created_at.getTime());
            return {
              failure_type: rows[0].failure_type,
              stage: rows[0].stage,
              count: rows.length,
              sample_messages: sorted.slice(0, 3).map((r) => r.user_message),
              first_seen: new Date(Math.min(...times)),
              last_seen: new Date(Math.max(...times)),
            };
          })
          .sort((a, b) => b.count - a.count)
          .slice(0, 20);
      }

      // --- findStaleComplaints: status aktif + updated_at < now - staleDays (+ filter village)
      if (/cases\.complaints/i.test(text)) {
        const [staleDays, maybeVillage] = values as [number, string?];
        const hasVillageFilter = /c\.village_id\s*=\s*\?/i.test(text);
        const villageId = hasVillageFilter ? maybeVillage : undefined;
        const cutoff = Date.now() - Number(staleDays) * 86_400_000;
        const active = new Set(['OPEN', 'PENDING', 'IN_PROGRESS', 'VERIFIED']);
        return store.complaints
          .filter(
            (c) =>
              c.deleted_at === null &&
              active.has(c.status) &&
              c.updated_at.getTime() < cutoff &&
              (!villageId || c.village_id === villageId),
          )
          .sort((a, b) => a.updated_at.getTime() - b.updated_at.getTime())
          .slice(0, 50)
          .map((c) => ({
            ...c,
            days_stale: Math.floor((Date.now() - c.updated_at.getTime()) / 86_400_000),
          }));
      }

      // pgvector / query lain yang tidak relevan untuk skenario ini
      return [];
    }),
    user_memory_entries: {
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }): Promise<MemoryRow> => {
        const row: MemoryRow = {
          id: `mem-${store.memories.length + 1}`,
          created_at: new Date(),
          metadata_json: null,
          last_accessed_at: null,
          wa_user_id: '',
          village_id: null,
          memory_type: '',
          memory_key: null,
          content: '',
          importance: 0,
          ...(data as Partial<MemoryRow>),
        };
        store.memories.push(row);
        return row;
      }),
      findMany: vi.fn(async (args: {
        where: { wa_user_id: string; village_id?: string | null; memory_type?: { in: string[] } };
        take?: number;
      }): Promise<MemoryRow[]> => {
        const { where } = args;
        const rows = store.memories
          .filter(
            (m) =>
              m.wa_user_id === where.wa_user_id &&
              (where.village_id === undefined || m.village_id === where.village_id) &&
              (!where.memory_type?.in || where.memory_type.in.includes(m.memory_type)),
          )
          .sort((a, b) => b.created_at.getTime() - a.created_at.getTime());
        return args.take ? rows.slice(0, args.take) : rows;
      }),
      updateMany: vi.fn(async (): Promise<{ count: number }> => ({ count: 0 })),
    },
  };

  // findStaleComplaints memakai Prisma.sql`...` → perlu export Prisma di mock.
  const PrismaMock = {
    sql: (strings: TemplateStringsArray, ...values: unknown[]) => ({
      strings: [...strings],
      values,
    }),
  };

  return { store, fakePrisma, PrismaMock };
});

vi.mock('@prisma/client', () => ({
  PrismaClient: vi.fn(() => fakePrisma),
  Prisma: PrismaMock,
}));

vi.mock('../../utils/internal-auth', () => ({
  internalApiKeyMatches: (v: unknown) => v === 'test-internal-key',
}));

// searchUserMemories() memanggil generateEmbedding() (jaringan LLM) untuk jalur
// semantik — mock hanya titik itu; jalur leksikal + ranking tetap jalan asli.
vi.mock('../../services/embedding.service', async (importOriginal) => {
  const orig = await importOriginal<Record<string, unknown>>();
  return {
    ...orig,
    generateEmbedding: vi.fn(async () => ({
      values: new Array(768).fill(0),
      model: 'mock-embed',
      dimensions: 768,
    })),
  };
});

import smartFeaturesRoutes from '../smart-features.routes';
import { recordFailure } from '../../services/improvement-loop.service';
import {
  saveSessionSummary,
  buildLastInteractionContext,
} from '../../services/last-interaction.service';
import {
  shouldClarify,
  parseClarificationAnswer,
} from '../../services/confidence-clarification.service';
import { transitionsFrom } from '../../pipeline/stage-graph';
import type { Stage } from '../../pipeline/stage-types';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const INTERNAL_KEY = 'test-internal-key';
const VILLAGE = 'desa-sanreseng-ade';

async function mount(
  router: express.Router,
  base: string,
): Promise<{ baseUrl: string; close: () => void }> {
  const app: Express = express();
  app.use(express.json());
  app.use(base, router);
  const server = app.listen(0, '127.0.0.1');
  await new Promise<void>((resolve) => server.once('listening', resolve));
  const { port } = server.address() as AddressInfo;
  return { baseUrl: `http://127.0.0.1:${port}`, close: () => server.close() };
}

const servers: Array<() => void> = [];
afterAll(() => {
  for (const close of servers) close();
  servers.length = 0;
});

beforeEach(() => {
  store.failures.length = 0;
  store.memories.length = 0;
  store.complaints.length = 0;
});

const daysAgo = (n: number): Date => new Date(Date.now() - n * 86_400_000);

// ---------------------------------------------------------------------------
// a. Improvement loop
// ---------------------------------------------------------------------------

describe('a. improvement loop E2E', () => {
  it('failure → tercatat → teragregasi jadi pola → saran perbaikan muncul via route', async () => {
    // Skenario realistis Desa Sanreseng Ade:
    // - 8x warga tanya "syarat bikin KTP" → agent fallback (stage TRIAGE)
    for (let i = 0; i < 8; i++) {
      await recordFailure({
        village_id: VILLAGE,
        session_id: `sess-ktp-${i}`,
        user_message: 'syarat bikin KTP apa ya?',
        failure_type: 'fallback',
        stage: 'TRIAGE',
        intent: 'information',
      });
    }
    // - 6x assessor ragu soal "jadwal posyandu" (stage COLLECT)
    for (let i = 0; i < 6; i++) {
      await recordFailure({
        village_id: VILLAGE,
        session_id: `sess-posyandu-${i}`,
        user_message: 'jadwal posyandu bulan ini kapan?',
        failure_type: 'low_confidence',
        stage: 'COLLECT',
      });
    }
    // - 2x error teknis — di bawah threshold (5), tidak boleh jadi saran
    for (let i = 0; i < 2; i++) {
      await recordFailure({
        village_id: VILLAGE,
        session_id: `sess-err-${i}`,
        user_message: 'cek status',
        failure_type: 'error',
        stage: 'EXECUTE',
      });
    }
    // - 1 failure 8 hari lalu — di luar jendela analisis 7 hari
    await recordFailure({
      village_id: VILLAGE,
      session_id: 'sess-old',
      user_message: 'syarat bikin KTP apa ya?',
      failure_type: 'fallback',
      stage: 'TRIAGE',
    });
    store.failures[store.failures.length - 1].created_at = daysAgo(8);

    const { baseUrl, close } = await mount(smartFeaturesRoutes, '/api/internal');
    servers.push(close);

    const res = await fetch(`${baseUrl}/api/internal/improvement/analyze`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-internal-api-key': INTERNAL_KEY,
      },
      body: JSON.stringify({ village_id: VILLAGE }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      status: string;
      data: {
        patterns: Array<{ failure_type: string; stage: string | null; count: number; sample_messages: string[] }>;
        suggestions: Array<{ suggestion_type: string; suggestion: string; priority: string }>;
      };
    };
    expect(body.status).toBe('success');
    const { patterns, suggestions } = body.data;

    // Pola fallback 8x (failure 8-hari-lalu TIDAK ikut)
    const fallback = patterns.find((p) => p.failure_type === 'fallback');
    expect(fallback).toBeDefined();
    expect(fallback!.count).toBe(8);
    expect(fallback!.sample_messages[0]).toContain('syarat bikin KTP');

    // Pola di bawah threshold tetap terlihat tapi tidak jadi saran
    const errPattern = patterns.find((p) => p.failure_type === 'error');
    expect(errPattern!.count).toBe(2);
    expect(suggestions.some((s) => s.suggestion_type === 'fix_prompt')).toBe(false);

    // Saran: fallback berulang → tambah dokumen KB; ragu berulang → tambah question variant
    const kbSug = suggestions.find((s) => s.suggestion_type === 'add_kb_document');
    expect(kbSug).toBeDefined();
    expect(kbSug!.suggestion).toMatch(/8x/);
    const varSug = suggestions.find((s) => s.suggestion_type === 'add_question_variant');
    expect(varSug).toBeDefined();
    expect(varSug!.suggestion).toMatch(/6x/);
    expect(suggestions).toHaveLength(2);
  });

  it('PII di pesan failure ter-redact sebelum bisa dibaca via GET /improvement/failures', async () => {
    await recordFailure({
      village_id: VILLAGE,
      session_id: 'sess-pii',
      user_message: 'NIK saya 3271010101010001, tolong cek status KTP',
      failure_type: 'fallback',
      stage: 'TRIAGE',
    });

    const { baseUrl, close } = await mount(smartFeaturesRoutes, '/api/internal');
    servers.push(close);

    const res = await fetch(
      `${baseUrl}/api/internal/improvement/failures?village_id=${VILLAGE}&days=7`,
      { headers: { 'x-internal-api-key': INTERNAL_KEY } },
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      data: { patterns: Array<{ sample_messages: string[] }> };
    };
    const samples = body.data.patterns.flatMap((p) => p.sample_messages).join(' | ');
    expect(samples).toContain('[NIK_REDACTED]');
    expect(samples).not.toContain('3271010101010001');
  });

  it('menolak tanpa internal API key', async () => {
    const { baseUrl, close } = await mount(smartFeaturesRoutes, '/api/internal');
    servers.push(close);
    const res = await fetch(`${baseUrl}/api/internal/improvement/analyze`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ village_id: VILLAGE }),
    });
    expect(res.status).toBe(403);
  });
});

// ---------------------------------------------------------------------------
// b. Cross-session memory
// ---------------------------------------------------------------------------

describe('b. cross-session memory E2E', () => {
  it('ringkasan sesi tersimpan → sesi baru → konteks lama ter-inject (redacted)', async () => {
    const wa = '6281234567890';

    // Sesi 1 berakhir: ringkasan disimpan (seperti dipanggil saat session-end)
    await saveSessionSummary({
      wa_user_id: wa,
      village_id: VILLAGE,
      summary:
        'Warga lapor jalan rusak di RT 03. Tiket LAP-20261001-001 dibuat, status OPEN. ' +
        'NIK warga 3271010101010001, hubungi 081234567890.',
    });

    // Sesi 2 (baru, session_id berbeda — hanya wa_user_id yang sama):
    // konteks interaksi terakhir harus ter-inject ke prompt.
    const ctx = await buildLastInteractionContext(wa, VILLAGE);

    expect(ctx).toBeDefined();
    expect(ctx!).toContain('[INTERAKSI TERAKHIR');
    expect(ctx!).toContain('jalan rusak di RT 03');
    expect(ctx!).toContain('LAP-20261001-001');
    // PII ter-redact — tidak bocor mentah ke prompt
    expect(ctx!).not.toContain('3271010101010001');
    expect(ctx!).not.toContain('081234567890');
    expect(ctx!).toContain('[NIK]');
    expect(ctx!).toContain('[HP]');
  });

  it('tidak bocor ke user lain; tidak ada memori → undefined', async () => {
    await saveSessionSummary({
      wa_user_id: '6281234567890',
      village_id: VILLAGE,
      summary: 'Warga lapor jalan rusak di RT 03.',
    });

    const other = await buildLastInteractionContext('6289999999999', VILLAGE);
    expect(other).toBeUndefined();

    const empty = await buildLastInteractionContext('6280000000000', VILLAGE);
    expect(empty).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// c. Proactive followup
// ---------------------------------------------------------------------------

describe('c. proactive followup E2E', () => {
  function seedComplaints(): void {
    store.complaints.push(
      {
        id: 'c1', complaint_id: 'LAP-20260925-001', wa_user_id: '6281234567890',
        village_id: VILLAGE, kategori: 'infrastruktur',
        deskripsi: 'Jalan rusak parah di RT 03, mohon segera diperbaiki karena membahayakan',
        rt_rw: 'RT 03/RW 01', reporter_name: 'Pak Budi', status: 'OPEN',
        created_at: daysAgo(6), updated_at: daysAgo(6), deleted_at: null,
      },
      {
        id: 'c2', complaint_id: 'LAP-20260922-002', wa_user_id: '6289876543210',
        village_id: VILLAGE, kategori: 'penerangan',
        deskripsi: 'Lampu jalan mati di gang melati sudah seminggu',
        rt_rw: 'Gang Melati', reporter_name: 'Bu Siti', status: 'IN_PROGRESS',
        created_at: daysAgo(9), updated_at: daysAgo(9), deleted_at: null,
      },
      {
        id: 'c3', complaint_id: 'LAP-20260930-003', wa_user_id: '6281111111111',
        village_id: VILLAGE, kategori: 'kebersihan',
        deskripsi: 'Sampah menumpuk di TPS',
        rt_rw: null, reporter_name: 'Pak Andi', status: 'OPEN',
        created_at: daysAgo(1), updated_at: daysAgo(1), deleted_at: null, // belum stale
      },
      {
        id: 'c4', complaint_id: 'LAP-20260920-004', wa_user_id: '6282222222222',
        village_id: VILLAGE, kategori: 'infrastruktur',
        deskripsi: 'Jembatan bambu rusak',
        rt_rw: null, reporter_name: 'Pak Joko', status: 'RESOLVED',
        created_at: daysAgo(10), updated_at: daysAgo(10), deleted_at: null, // sudah selesai
      },
      {
        id: 'c5', complaint_id: 'LAP-20260924-005', wa_user_id: null, // tanpa kontak WA
        village_id: VILLAGE, kategori: 'administrasi',
        deskripsi: 'KTP belum jadi',
        rt_rw: null, reporter_name: null, status: 'OPEN',
        created_at: daysAgo(7), updated_at: daysAgo(7), deleted_at: null,
      },
      {
        id: 'c6', complaint_id: 'LAP-20260923-006', wa_user_id: '6283333333333',
        village_id: 'desa-lain', kategori: 'infrastruktur', // desa lain
        deskripsi: 'Jalan berlubang',
        rt_rw: null, reporter_name: 'Pak Rudi', status: 'OPEN',
        created_at: daysAgo(8), updated_at: daysAgo(8), deleted_at: null,
      },
    );
  }

  it('laporan stale >3 hari masuk kandidat; TANPA pengiriman otomatis', async () => {
    seedComplaints();

    const { baseUrl, close } = await mount(smartFeaturesRoutes, '/api/internal');
    servers.push(close);

    const res = await fetch(
      `${baseUrl}/api/internal/followup/candidates?village_id=${VILLAGE}&stale_days=3`,
      { headers: { 'x-internal-api-key': INTERNAL_KEY } },
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      status: string;
      data: {
        candidates: Array<{
          complaint: { complaint_id: string };
          message: string;
          suggested_action: string;
        }>;
        count: number;
        note: string;
      };
    };
    expect(body.status).toBe('success');

    // Hanya 2 kandidat: yg belum stale / sudah selesai / tanpa WA / desa lain tersaring
    expect(body.data.count).toBe(2);
    const ids = body.data.candidates.map((c) => c.complaint.complaint_id);
    expect(ids).toContain('LAP-20260925-001');
    expect(ids).toContain('LAP-20260922-002');
    expect(ids).not.toContain('LAP-20260930-003'); // 1 hari: belum stale
    expect(ids).not.toContain('LAP-20260920-004'); // RESOLVED
    expect(ids).not.toContain('LAP-20260924-005'); // tanpa wa_user_id
    expect(ids).not.toContain('LAP-20260923-006'); // desa lain

    // Urut tertua dulu; aksi sesuai umur: 9 hari → eskalasi, 6 hari → cek status
    const [oldest, newer] = body.data.candidates;
    expect(oldest.suggested_action).toBe('escalate');
    expect(oldest.message).toContain('Bu Siti');
    expect(oldest.message).toMatch(/perangkat desa|diteruskan/);
    expect(newer.suggested_action).toBe('check_status');
    expect(newer.message).toContain('Pak Budi');
    expect(newer.message).toMatch(/cek status/);

    // TIDAK auto-send: endpoint hanya me-return kandidat untuk approval admin
    expect(body.data.note).toMatch(/tidak ada pengiriman otomatis/i);
  });

  it('tidak ada endpoint pengiriman follow-up otomatis', async () => {
    const { baseUrl, close } = await mount(smartFeaturesRoutes, '/api/internal');
    servers.push(close);
    const res = await fetch(`${baseUrl}/api/internal/followup/send`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-internal-api-key': INTERNAL_KEY },
      body: JSON.stringify({ village_id: VILLAGE }),
    });
    expect(res.status).toBe(404);
  });
});

// ---------------------------------------------------------------------------
// d. Confidence clarification — kontrak 2-turn pipeline
// ---------------------------------------------------------------------------

describe('d. confidence clarification E2E (kontrak 2-turn pipeline)', () => {
  /**
   * Mereplikasi sekuens process-message-v2.ts:726-731:
   * kandidat = transitionsFrom(stage).filter(fuzzy).map(to).slice(0,2)
   * clar = shouldClarify(confidence, stage, kandidat)
   */
  function pipelineClarify(confidence: number, stage: string) {
    const candidates = transitionsFrom(stage as Stage)
      .filter((t) => t.kind === 'fuzzy')
      .map((t) => t.to)
      .slice(0, 2);
    return { candidates, clar: shouldClarify(confidence, stage, candidates) };
  }

  it('confidence 0.45 → pertanyaan klarifikasi SPESIFIK dengan opsi (a)/(b)', () => {
    // Skenario: warga jawab ambigu saat tahap verifikasi ("iya bener" —
    // bener yang mana?). Assessor: stage VERIFY, confidence 0.45.
    const { candidates, clar } = pipelineClarify(0.45, 'VERIFY');

    // Kandidat berasal dari stage-graph pipeline yang asli
    expect(candidates).toEqual(['VERIFY', 'TRIAGE']);
    expect(clar.needed).toBe(true);
    expect(clar.question).toBeDefined();

    const q = clar.question!;
    // Spesifik: menyebut opsi konkret berhuruf, bukan "maksud Anda apa?" generik
    expect(q).toContain('(a)');
    expect(q).toContain('(b)');
    expect(q).toContain('Apakah yang Anda maksud');
    expect(q).toContain('konfirmasi'); // label spesifik opsi (a)
    expect(q).toContain('memulai percakapan'); // label spesifik opsi (b)
    expect(clar.candidates).toHaveLength(2);

    // Turn 2: warga balas "b" → pipeline me-routing ke TRIAGE (bukan tebakan)
    // (pipeline menyimpan clar.candidates di ctx.slots['__clarification_candidates'])
    const chosen = parseClarificationAnswer('b', clar.candidates!);
    expect(chosen).toBe('TRIAGE');
    expect(parseClarificationAnswer('a', clar.candidates!)).toBe('VERIFY');

    // Jawaban ngawur → null (tidak di-routing ke mana-mana, tidak ngarang)
    expect(parseClarificationAnswer('kucing makan nasi goreng', clar.candidates!)).toBeNull();
    expect(parseClarificationAnswer('', clar.candidates!)).toBeNull();
  });

  it('confidence tinggi (0.85) → tidak ada klarifikasi, flow normal', () => {
    const { clar } = pipelineClarify(0.85, 'VERIFY');
    expect(clar.needed).toBe(false);
    expect(clar.question).toBeUndefined();
  });

  it('confidence sangat rendah (0.2) → bukan klarifikasi (jalur handoff)', () => {
    const { clar } = pipelineClarify(0.2, 'VERIFY');
    expect(clar.needed).toBe(false);
  });

  it('stage tanpa transisi fuzzy (COLLECT) → klarifikasi dengan opsi "hal lain"', () => {
    // Perilaku terdokumentasi di confidence-clarification.service:
    // jika hanya 1 kandidat, opsi "hal lain" ditambahkan agar user tidak terjebak.
    const { candidates, clar } = pipelineClarify(0.45, 'COLLECT');
    expect(candidates).toHaveLength(0);
    expect(clar.needed).toBe(true);
    expect(clar.question).toContain('(a)');
    expect(clar.question).toContain('(b)');
    expect(clar.question).toContain('hal lain');
    expect(clar.candidates).toHaveLength(2);
    expect(parseClarificationAnswer('b', clar.candidates!)).toBe('OTHER');
  });
});
