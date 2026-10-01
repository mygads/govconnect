/**
 * Query Rewriting sebelum RAG retrieval (deterministik, tanpa LLM).
 *
 * Masalah: pertanyaan anaforis/pendek ("kapan selesainya?", "syaratnya apa
 * aja?") menghasilkan embedding yang miskin konteks sehingga retrieval gagal
 * menemukan dokumen yang relevan — padahal topiknya sudah jelas dari
 * percakapan sebelumnya (mis. laporan LAP-20261001-001, atau "KTP").
 *
 * Solusi: langkah rewrite deterministik yang menggabungkan pertanyaan dengan
 * konteks percakapan terakhir (topik aktif + entitas yang sedang dibahas)
 * menjadi query lengkap SEBELUM embedding/expansion. Dipakai di
 * `retrieveContext()` (rag.service.ts) — satu funnel untuk semua retrieval.
 *
 * Keputusan desain (didokumentasikan sesuai permintaan tugas):
 * - DETERMINISTIK dulu (template + regex + konteks), TANPA micro-LLM.
 *   Alasan: (1) rewrite berjalan di critical path setiap retrieval —
 *   satu panggilan LLM ekstra menambah ~1 dtk latensi dan biaya per
 *   retrieval; (2) aturan anafora deterministik dapat diuji secara unit
 *   dengan kepastian 100% (tidak ada flakiness model); (3) jalur RAG sudah
 *   punya LLM expansion sebagai fallback (expandQuery) — menambah LLM
 *   kedua untuk rewrite adalah duplikasi biaya dengan manfaat marjinal;
 *   (4) rewrite yang salah (halusinasi topik oleh LLM) lebih berbahaya
 *   daripada tidak rewrite — aturan deterministik bersifat konservatif:
 *   hanya rewrite bila ada sinyal anafora yang jelas DAN konteks tersedia.
 * - TIDAK rewrite bila pertanyaan sudah lengkap (hemat + aman): query yang
 *   sudah menyebut topik/entitasnya sendiri, atau tanpa penanda anafora,
 *   diteruskan apa adanya.
 * - Makna tidak diubah: rewrite HANYA menempelkan frasa nomina topik dari
 *   konteks ke akhir pertanyaan; teks pertanyaan asli dipertahankan utuh
 *   di awal hasil rewrite (diassert di unit test).
 *
 * Batas jujur: rewrite deterministik tidak bisa menyelesaikan anafora yang
 * ambigu (mis. dua laporan aktif sekaligus — diambil yang paling baru) dan
 * tidak menangani koreferensi lintas kalimat yang kompleks. Untuk itu
 * jalur VERIFY tetap ditangani assessor P1-11; rewrite ini khusus jalur
 * RAG retrieval.
 */

export interface QueryRewriteContext {
  /**
   * Topik aktif yang sedang dibahas, mis. "laporan LAP-20261001-001
   * (jalan rusak)" atau "KTP". Sumber utama: turnState/slots atau
   * ekstraksi deterministik dari turn terakhir.
   */
  activeTopic?: string;
  /** Entitas lain yang sedang dibahas, mis. ["surat domisili"]. */
  entities?: string[];
  /**
   * Beberapa turn terakhir ("Warga: ..."/"Asisten: ..."). Dipakai sebagai
   * fallback bila activeTopic kosong: topik diekstrak deterministik via
   * regex (nomor tiket, kata kunci layanan).
   */
  recentTurns?: string[];
}

export interface RewriteResult {
  /** Query final untuk retrieval (== query asli bila tidak di-rewrite). */
  rewritten: string;
  didRewrite: boolean;
  /** Alasan mesin: 'no_context' | 'already_complete' | 'rewritten' | ... */
  reason: string;
}

// ── Sinyal anafora ──────────────────────────────────────────────────────

/** Demonstrativa/pronomina yang jelas merujuk ke sesuatu di konteks. */
const ANAPHORIC_WORDS = /\b(ini|itu|tersebut|dia|beliau|mereka|nya)\b/i;

/**
 * Kata berakhiran "-nya" yang anaforis ("selesainya", "biayanya").
 * Dikecualikan kata yang "-nya"-nya bukan klitika anafora.
 */
const NYA_EXCLUSIONS = new Set(['punya', 'hanya', 'tanya']);

/** Interogatif telanjang (<=3 kata) yang mau tak mau merujuk ke topik aktif. */
const BARE_INTERROGATIVES =
  /^(kapan|berapa|gimana|bagaimana|kenapa|mengapa|kok|apakah|dimana|di mana|sudah|belum|jadi)\b/i;
const BARE_INTERROGATIVE_MAX_WORDS = 3;

/** Referensi nomor tiket/layanan: LAP-xxx, LAY-xxx, TMP-xxx, SRV-xxx, REQ-xxx. */
const TICKET_REF_PATTERN = /\b((?:LAP|LAY|TMP|SRV|REQ)-[A-Za-z0-9-]+)/i;

/**
 * Kata kunci layanan yang cukup spesifik untuk menjadi topik bila tidak ada
 * sinyal yang lebih kuat. Dipakai hanya sebagai fallback ekstraksi.
 */
const SERVICE_KEYWORDS =
  /\b(ktp|kk|akta|akte|sktm|skck|domisili|surat keterangan|pindah|nikah|kematian|kelahiran|iumk|imb|umkm|bansos|pkh|bpjs|jalan rusak|drainase|sampah|lampu jalan)\b/i;

/** Stopword untuk ekstraksi kata kunci topik. */
const TOPIC_STOPWORDS = new Set([
  'yang', 'dan', 'untuk', 'dengan', 'dari', 'pada', 'dalam', 'ini', 'itu',
  'tentang', 'mengenai', 'soal', 'atau', 'juga', 'sudah', 'akan', 'adalah',
  'sebagai', 'oleh', 'ke', 'di', 'laporan', 'pengajuan', 'surat', 'nomor',
]);

const MAX_TOPIC_LABEL_CHARS = 120;

function countWords(q: string): number {
  return q.trim().split(/\s+/).filter(Boolean).length;
}

function hasNyaAnaphor(query: string): boolean {
  const words = query.toLowerCase().split(/\s+/);
  return words.some(
    (w) => w.length > 3 && w.endsWith('nya') && !NYA_EXCLUSIONS.has(w),
  );
}

/** True bila query mengandung penanda anafora yang jelas. */
export function hasAnaphoricSignal(query: string): boolean {
  if (ANAPHORIC_WORDS.test(query)) return true;
  if (hasNyaAnaphor(query)) return true;
  const trimmed = query.trim();
  if (
    countWords(trimmed) <= BARE_INTERROGATIVE_MAX_WORDS &&
    BARE_INTERROGATIVES.test(trimmed)
  ) {
    return true;
  }
  return false;
}

/**
 * Kata-kata signifikan dari sebuah label topik/entitas (untuk deteksi
 * "query sudah menyebut topiknya sendiri").
 */
function significantWords(label: string): string[] {
  return label
    .toLowerCase()
    .split(/[^a-z0-9-]+/)
    .filter((w) => w.length >= 3 && !TOPIC_STOPWORDS.has(w));
}

/** True bila query sudah menyebut topik/entitas konteks secara eksplisit. */
function mentionsOwnTopic(query: string, ctx: QueryRewriteContext): boolean {
  const q = query.toLowerCase();
  const labels = [
    ...(ctx.activeTopic ? [ctx.activeTopic] : []),
    ...(ctx.entities ?? []),
  ];
  for (const label of labels) {
    // Nomor tiket: pencocokan eksak (case-insensitive).
    const ticket = label.match(TICKET_REF_PATTERN);
    if (ticket && q.includes(ticket[1].toLowerCase())) return true;
    // Kata signifikan: satu saja cukup sebagai bukti query sudah lengkap.
    if (significantWords(label).some((w) => q.includes(w))) return true;
  }
  return false;
}

function hasUsableContext(ctx?: QueryRewriteContext): ctx is QueryRewriteContext {
  if (!ctx) return false;
  return Boolean(
    ctx.activeTopic?.trim() ||
      (ctx.entities && ctx.entities.some((e) => e?.trim())) ||
      (ctx.recentTurns && ctx.recentTurns.some((t) => t?.trim())),
  );
}

/**
 * Rewrite deterministik: gabungkan pertanyaan anaforis dengan topik aktif
 * menjadi query lengkap. Pure function — tanpa I/O, unit-testable.
 */
export function rewriteQueryForRAG(
  query: string,
  ctx?: QueryRewriteContext,
): RewriteResult {
  const original = query?.trim() ?? '';
  if (!original) {
    return { rewritten: query, didRewrite: false, reason: 'empty_query' };
  }

  // Aturan hemat #1: tanpa konteks -> tidak ada yang bisa ditempelkan.
  if (!hasUsableContext(ctx)) {
    return { rewritten: original, didRewrite: false, reason: 'no_context' };
  }
  const context = ctx as QueryRewriteContext;

  // Aturan hemat #2: query sudah menyebut topiknya -> sudah lengkap.
  if (mentionsOwnTopic(original, context)) {
    return { rewritten: original, didRewrite: false, reason: 'already_mentions_topic' };
  }

  // Aturan hemat #3: tanpa sinyal anafora -> anggap sudah lengkap.
  if (!hasAnaphoricSignal(original)) {
    return { rewritten: original, didRewrite: false, reason: 'no_anaphoric_signal' };
  }

  // [P2-3 FIX] Deteksi pola multi-entity: "semua itu", "semuanya", "keduanya", "masing-masing"
  // Jika ada, gabungkan SEMUA entitas konteks, bukan hanya activeTopic
  const MULTI_ENTITY_PATTERN = /\b(semua\s+itu|semuanya|keduanya|masing-masing|total\s+semuanya)\b/i;
  const isMultiEntityQuery = MULTI_ENTITY_PATTERN.test(original);

  // Susun label konteks: topik aktif dulu, lalu entitas yang belum disebut.
  const qLower = original.toLowerCase();
  const bits: string[] = [];
  if (isMultiEntityQuery) {
    // Multi-entity: kumpulkan semua entitas unik dari konteks
    const allEntities = new Set<string>();
    if (context.activeTopic?.trim()) allEntities.add(context.activeTopic.trim());
    for (const e of context.entities ?? []) {
      const trimmed = e?.trim();
      if (trimmed) allEntities.add(trimmed);
    }
    // Juga ekstrak dari recentTurns jika entities kosong
    if (allEntities.size <= 1 && context.recentTurns?.length) {
      for (const turn of context.recentTurns.slice(-4)) {
        const svcMatch = turn.match(/\b(ktp|kk|kartu keluarga|sktm|domisili|surat keterangan \w+|akta kelahiran)\b/gi);
        if (svcMatch) svcMatch.forEach(m => allEntities.add(m.trim()));
      }
    }
    bits.push(...allEntities);
  } else if (context.activeTopic?.trim()) {
    bits.push(context.activeTopic.trim());
  }
  for (const e of context.entities ?? []) {
    const trimmed = e?.trim();
    if (trimmed && !significantWords(trimmed).some((w) => qLower.includes(w))) {
      bits.push(trimmed);
    }
  }
  // Fallback: ekstrak topik dari turn terakhir bila activeTopic kosong.
  if (bits.length === 0 && context.recentTurns?.length) {
    const derived = deriveTopicFromTurns(context.recentTurns);
    if (derived) bits.push(derived);
  }
  if (bits.length === 0) {
    return { rewritten: original, didRewrite: false, reason: 'no_derivable_topic' };
  }

  let label = bits.join(' ').replace(/\s+/g, ' ').trim();
  if (label.length > MAX_TOPIC_LABEL_CHARS) {
    label = label.slice(0, MAX_TOPIC_LABEL_CHARS).trim();
  }

  // Pertahankan pertanyaan asli utuh di depan; tempelkan label topik di
  // belakang. Makna tidak berubah — hanya spesialisasi.
  const wasQuestion = /[?？]\s*$/.test(original);
  const core = original.replace(/[.?!…？]+\s*$/, '').trim();
  const rewritten = wasQuestion ? `${core} ${label}?` : `${core} ${label}`;

  return { rewritten, didRewrite: true, reason: 'anaphoric_with_topic' };
}

/**
 * Ekstrak topik deterministik dari turn terakhir (fallback bila activeTopic
 * tidak disediakan caller). Prioritas: nomor tiket > kata kunci layanan.
 * Dipindai dari turn paling baru ke paling lama.
 */
export function deriveTopicFromTurns(recentTurns: string[]): string | null {
  const turns = (recentTurns ?? []).filter((t) => t?.trim());
  for (let i = turns.length - 1; i >= 0; i--) {
    const turn = turns[i];
    const ticket = turn.match(TICKET_REF_PATTERN);
    if (ticket) {
      const ref = ticket[1].toUpperCase();
      const kind = ref.startsWith('LAP')
        ? 'laporan'
        : ref.startsWith('LAY')
          ? 'pengajuan layanan'
          : 'tiket';
      return `${kind} ${ref}`;
    }
  }
  for (let i = turns.length - 1; i >= 0; i--) {
    const kw = turns[i].match(SERVICE_KEYWORDS);
    if (kw) return kw[1];
  }
  return null;
}

/**
 * Bangun QueryRewriteContext dari artefak percakapan yang dimiliki caller.
 * Deterministik — tidak memanggil LLM. Summary bahasa alami sengaja TIDAK
 * diparsing (ekstraksi topik dari prosa bebas tidak reliabel tanpa LLM);
 * yang dipakai: slots (turnState) dan recentMessages.
 */
export function buildQueryRewriteContext(input: {
  summary?: string | null;
  recentMessages?: Array<{ role: string; content: string }> | null;
  slots?: Record<string, unknown> | null;
}): QueryRewriteContext {
  const ctx: QueryRewriteContext = {};
  const entities: string[] = [];

  // 1. Dari slots (turnState): referensi tiket + nama layanan/kategori.
  const slots = input.slots ?? {};
  const slotStrings: string[] = [];
  const collectStrings = (v: unknown): void => {
    if (typeof v === 'string' && v.trim()) slotStrings.push(v.trim());
    else if (Array.isArray(v)) v.forEach(collectStrings);
    else if (v && typeof v === 'object') Object.values(v).forEach(collectStrings);
  };
  collectStrings(slots);

  const slotTicketRefs = new Set<string>();
  for (const s of slotStrings) {
    const m = s.match(TICKET_REF_PATTERN);
    if (m) slotTicketRefs.add(m[1].toUpperCase());
  }
  if (slotTicketRefs.size > 0) {
    const [first, ...rest] = [...slotTicketRefs];
    const kind = first.startsWith('LAP')
      ? 'laporan'
      : first.startsWith('LAY')
        ? 'pengajuan layanan'
        : 'tiket';
    ctx.activeTopic = `${kind} ${first}`;
    entities.push(...rest.map((r) => `tiket ${r}`));
  }
  // Nama layanan/kategori aktif (mis. dari triage list) sebagai topik.
  if (!ctx.activeTopic) {
    const serviceName = ['kategori', 'kategori_title', 'layanan', 'service_name', 'activeServiceName']
      .map((k) => slots[k])
      .find((v) => typeof v === 'string' && (v as string).trim().length >= 3) as string | undefined;
    if (serviceName) ctx.activeTopic = serviceName.trim();
  }

  // 2. Dari recentMessages: turn terakhir sebagai fallback/penegas.
  const turns = (input.recentMessages ?? [])
    .filter((m) => m?.content?.trim())
    .slice(-4)
    .map((m) => `${m.role === 'assistant' ? 'Asisten' : 'Warga'}: ${m.content.trim()}`);
  if (turns.length > 0) ctx.recentTurns = turns;

  if (!ctx.activeTopic && turns.length > 0) {
    const derived = deriveTopicFromTurns(turns);
    if (derived) ctx.activeTopic = derived;
  }
  // Entitas tambahan: nomor tiket lain yang muncul di turn tapi bukan topik.
  for (const t of turns) {
    const m = t.match(TICKET_REF_PATTERN);
    if (m) {
      const ref = m[1].toUpperCase();
      if (!ctx.activeTopic?.toUpperCase().includes(ref) && !entities.some((e) => e.includes(ref))) {
        entities.push(`tiket ${ref}`);
      }
    }
  }

  if (entities.length > 0) ctx.entities = entities.slice(0, 3);
  return ctx;
}
