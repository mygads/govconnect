/**
 * Prompt Builder — one coherent prompt, disclosure-first.
 *
 * Design (arsitektur-final §6):
 * - Static system prompt is BYTE-IDENTICAL across turns (prefix caching).
 * - Dynamic per-turn context (datetime, stage, scoped facts) goes in a
 *   separate user-role message.
 * - Disclosure: the agent identifies as the AI assistant of the village.
 * - Scoped facts only: tenant-scoped context builder, never raw profile
 *   dumps with NIK.
 */

import type { Stage } from './stage-types';
import { piiInbound } from '../gateway/pii-gateway';
import { DEFAULT_IDENTITY, type VillageIdentity } from '../services/village-identity.service';

/**
 * Version of the static system prompt below. MUST be bumped whenever the
 * static prompt text changes (it must stay byte-identical across turns for
 * provider prefix caching — a version bump marks exactly the moments it
 * legitimately changed). Recorded on every turn_completed audit event so
 * bad answers can be traced to the prompt that produced them.
 */
export const PROMPT_VERSION = '2026-09-29.1';

/**
 * R4 L1: fetch the village skill index for prompt injection. Lazy import so
 * prompt-builder's static import graph stays free of the prisma chain
 * (unit tests run without a generated Prisma client). Fail-soft: null on
 * any error → the turn simply has no skill index.
 */
async function skillIndexLines(tenantId: string): Promise<string | null> {
  try {
    const mod = await import('../services/skill-loader.service');
    return mod.renderSkillIndexForPrompt(await mod.getSkillIndex(tenantId));
  } catch {
    return null;
  }
}

export interface PromptInput {
  villageName: string;
  /** Generic tenant id (village today). Threaded into PII handling. */
  tenantId?: string;
  stage: Stage;
  /** Scoped facts: village profile, service info, RAG snippets (already tenant-scoped). */
  facts: string[];
  /** DB-grounded records (tickets, requests) — DB is always authoritative. */
  records: string[];
  /** Short conversation summary (no raw history dumps). */
  summary?: string;
  /** Language the user is writing in. */
  language?: string;
  /**
   * Per-village AI identity (nama, disclosure, persona) dari pengaturan
   * admin desa. Default: transparan, nama "Gana".
   */
  identity?: VillageIdentity;
  /**
   * R13: resolved experiment variant. The treatment promptSuffix is appended
   * to the DYNAMIC context only (static prompt stays byte-identical for
   * prefix caching). Shadow variants are never applied — the resolver
   * audits the assignment and the caller serves control.
   */
  experimentVariant?: {
    experimentName: string;
    variantKey: string;
    promptSuffix?: string;
    shadow: boolean;
  } | null;
}

/**
 * The static system prompt. Byte-identical per identity variant so the
 * provider can prefix-cache it (memoized by variant key). Never interpolate
 * per-turn data here. Identity (nama, disclosure, persona) berasal dari
 * pengaturan admin desa (village-identity.service).
 */
const staticPromptCache = new Map<string, string>();

function identityLines(identity: VillageIdentity): string[] {
  const name = identity.personaName;
  const lines = identity.disclosure
    ? [
        `Kamu adalah ${name}, asisten AI resmi layanan publik desa.`,
        'Selalu jujur bahwa kamu adalah AI bila ditanya; tegaskan kamu bukan petugas manusia.',
      ]
    : [
        `Kamu adalah ${name}, asisten layanan publik desa yang membantu warga via WhatsApp.`,
        'Jangan menyebut bahwa kamu adalah AI kecuali warga bertanya langsung; bila ditanya langsung, jawab jujur bahwa kamu adalah asisten AI. Jangan pernah mengaku sebagai manusia atau petugas desa.',
      ];
  if (identity.personaDescription) {
    lines.push(`[Persona dari admin desa] ${identity.personaDescription}`);
  }
  return lines;
}

export function buildStaticSystemPrompt(identity: VillageIdentity = DEFAULT_IDENTITY): string {
  const key = `${identity.disclosure ? 1 : 0}|${identity.personaName}|${identity.personaDescription ?? ''}`;
  const hit = staticPromptCache.get(key);
  if (hit) return hit;
  const prompt = [
    ...identityLines(identity),
    'Kamu membantu warga lewat WhatsApp: menjawab pertanyaan informasi, membantu cek status laporan, dan memandu pengaduan atau permohonan layanan.',
    '',
    'ATURAN KERAS:',
    '1. Jangan pernah mengarang: fakta hanya dari data resmi desa yang diberikan (profil desa, layanan, status tiket). Jika tidak ada datanya, katakan terus terang dan tawarkan menghubungkan ke perangkat desa.',
    '1b. Hierarki sumber (P0 > P1 > P2 > P3): data database (P0) selalu menang atas dokumen; dokumen resmi (P1) menang atas pengetahuan umum (P2); pengetahuan bawaanmu sebagai model (P3) BUKAN sumber fakta — jangan pernah menyajikan ingatanmu sebagai fakta desa.',
    '1c. "Tidak ditemukan" dari SATU tool (mis. found:false) BUKAN fakta bahwa layanan/informasi tidak ada — artinya hanya sumber itu yang tidak punya datanya. Hierarki P0>P1>P2 hanya berlaku bila DUA sumber memberi jawaban yang bertentangan. Bila satu sumber kosong tapi sumber lain (mis. dokumen/KB) punya jawabannya, pakai jawaban yang ada dan sebutkan sumbernya. Jangan pernah menolak menjawab hanya karena satu tool me-return found:false sementara tool lain menemukan datanya. PENTING: Jika sebuah tool sudah dipanggil dan me-return found:false, JANGAN panggil tool YANG SAMA lagi dengan argumen yang sama — itu buang waktu. Coba tool yang BERBEDA atau gunakan suggested_response yang diberikan.',
    '1d. JANGAN sebutkan label P0/P1/P2/P3 ke warga — itu istilah internal. JANGAN tambahkan caveat seperti "layanan belum terdaftar di database" bila kamu sudah punya jawaban dari dokumen resmi. Warga butuh jawaban, bukan penjelasan arsitektur sistem.',
    '2. Jangan pernah meminta atau menyimpan NIK, nomor KK, atau data sensitif lain kecuali alur resmi membutuhkannya — dan bila diminta, hanya lewat formulir resmi.',
    '3. Status tiket dari database selalu lebih benar daripada dokumen atau ingatanmu.',
    '4. Jangan menjawab di luar kewenangan: topik politik, hukum pidana, atau sengketa tanah → arahkan ke perangkat desa.',
    '5. Bahasa: ikuti bahasa warga (Indonesia santai atau bahasa daerah bila wajar), singkat, to-the-point, tanpa basa-basi berlebihan.',
    '6. Satu pesan per jawaban; jangan spam beberapa pesan.',
    '7. Jika ragu dan tidak ada data, lebih baik jujur "belum tahu" daripada menebak.',
    // R8 skip rule (DB→skip RAG): the relevance judgment ("sudah menjawab")
    // needs the model — a hard deterministic block on "DB returned non-empty"
    // would be unsafe because non-empty ≠ relevant (e.g. get_village_profile
    // returns data for any query). The model executes the skip; compliance is
    // measured via the rag_after_db_hit telemetry in staged-agent.
    '8. Hemat tool: bila data database (profil desa, info layanan, kontak) sudah menjawab pertanyaan warga, JANGAN panggil search_knowledge/search_documents. Database (P0) selalu lebih otoritatif daripada dokumen, jadi RAG sesudah DB yang menjawab hanya membuang biaya dan token.',
    // R4 progressive disclosure: the skill INDEX (L1) arrives in dynamic
    // context; the full procedure (L2) is pulled via load_skill only when
    // relevant — never dump procedures you have not loaded.
    '9. Prosedur resmi: bila [Panduan prosedur desa] di konteks mencantumkan panduan yang relevan, baca dulu via tool load_skill sebelum menjawab. Jangan menjawab tata cara dari ingatan bila ada panduannya.',
  ].join('\n');
  staticPromptCache.set(key, prompt);
  return prompt;
}

/** Dynamic per-turn context — delivered as a user-role message. */
export async function buildDynamicContext(input: PromptInput): Promise<string> {
  const lines: string[] = [];
  const now = new Date();
  lines.push(`[Konteks] Desa: ${input.villageName} | Tahap: ${input.stage} | Waktu: ${now.toLocaleString('id-ID')}`);
  if (input.language) lines.push(`[Bahasa warga] ${input.language}`);
  if (input.summary) {
    const { text } = await piiInbound(input.summary, input.tenantId ?? '');
    lines.push(`[Ringkasan percakapan]\n${text}`);
  }
  if (input.facts.length > 0) {
    const safe = await Promise.all(input.facts.map((f) => piiInbound(f, input.tenantId ?? '')));
    lines.push('[Fakta resmi desa]\n' + safe.map((s) => s.text).join('\n---\n'));
  }
  if (input.records.length > 0) {
    const safe = await Promise.all(input.records.map((r) => piiInbound(r, input.tenantId ?? '')));
    lines.push('[Data database — PALING OTORITATIF]\n' + safe.map((s) => s.text).join('\n---\n'));
  }
  // R4 L1 progressive disclosure: skill index for stages that answer
  // procedural questions. Compact (slug + one-liner each); the full
  // procedure loads on demand via load_skill. Fail-soft on DB outage.
  if ((input.stage === 'INFORMATION' || input.stage === 'COLLECT') && input.tenantId) {
    const rendered = await skillIndexLines(input.tenantId);
    if (rendered) lines.push(rendered);
  }
  lines.push('[Instruksi tahap] Jawab sesuai tahap di atas. Jangan melompat tahap.');
  // R13: experiment treatment prompt suffix — operator-authored variant
  // config, dynamic context only. Shadow variants never applied.
  const ev = input.experimentVariant;
  if (ev && !ev.shadow && ev.promptSuffix) {
    lines.push(`[Varian eksperimen ${ev.experimentName}/${ev.variantKey}]\n${ev.promptSuffix}`);
  }
  return lines.join('\n\n');
}

export interface BuiltPrompt {
  system: string;
  dynamicContext: string;
}

export async function buildPrompt(input: PromptInput): Promise<BuiltPrompt> {
  return {
    system: buildStaticSystemPrompt(input.identity ?? DEFAULT_IDENTITY),
    dynamicContext: await buildDynamicContext(input),
  };
}
