/**
 * Slot FSM — deterministic COLLECT/VERIFY state machine.
 *
 * Design (arsitektur-final §4, §6):
 * - The LLM proposes slot values conversationally; THIS module decides what
 *   is still missing and whether a value is valid. The FSM is the authority,
 *   not the model.
 * - Slot schemas are declarative per intent. Validation is pure functions.
 * - VERIFY renders a deterministic summary for confirmation — the model
 *   never invents the summary.
 */

export type SlotIntent = 'complaint' | 'service_request';

export interface SlotDef {
  name: string;
  label: string;
  required: boolean;
  /** Deterministic validator. Returns normalized value or an error message. */
  validate: (raw: string) => { ok: true; value: string } | { ok: false; error: string };
  /** Question to ask when the slot is missing. */
  prompt: string;
}

const nonEmpty = (min: number, label: string) => (raw: string) => {
  const v = raw.trim();
  if (v.length < min) return { ok: false as const, error: `${label} terlalu singkat, mohon dijelaskan sedikit lebih lengkap.` };
  return { ok: true as const, value: v };
};

export const SLOT_SCHEMAS: Record<SlotIntent, SlotDef[]> = {
  complaint: [
    {
      name: 'category', label: 'Kategori laporan', required: true,
      prompt: 'Laporan ini termasuk kategori apa? (misalnya: jalan rusak, sampah, air, penerangan, administrasi)',
      validate: nonEmpty(3, 'Kategori'),
    },
    {
      name: 'description', label: 'Deskripsi kejadian', required: true,
      prompt: 'Bisa dijelaskan kejadiannya? Sertakan apa yang terjadi dan sejak kapan.',
      validate: nonEmpty(10, 'Deskripsi'),
    },
    {
      name: 'location', label: 'Lokasi', required: true,
      prompt: 'Di mana lokasinya? (misalnya: RT/RW, dusun, atau patokan terdekat)',
      validate: nonEmpty(3, 'Lokasi'),
    },
    {
      name: 'reporter_name', label: 'Nama pelapor', required: false,
      prompt: 'Boleh tahu nama Anda untuk dicatat sebagai pelapor? (boleh dikosongkan)',
      validate: (raw) => ({ ok: true as const, value: raw.trim() }),
    },
  ],
  service_request: [
    {
      name: 'service_slug', label: 'Jenis layanan', required: true,
      prompt: 'Surat/layanan apa yang dibutuhkan? (misalnya: KTP, KK, surat keterangan domisili)',
      validate: nonEmpty(2, 'Jenis layanan'),
    },
    {
      name: 'service_note', label: 'Catatan', required: false,
      prompt: 'Ada catatan tambahan untuk layanan ini? (boleh dikosongkan)',
      validate: (raw) => ({ ok: true as const, value: raw.trim() }),
    },
  ],
};

export type Slots = Record<string, string>;

/**
 * P1-10: structured location parse.
 *
 * Natural Indonesian location mentions are decomposed into components so the
 * FSM stores a normalized location instead of a raw keyword grab:
 *   street  — "Jl. Mawar", "jalan merdeka no. 10", "gang melati"
 *   hamlet  — "krajan" (from "dusun krajan")
 *   rt/rw   — "02"/"05" (slash optional: "RT 02/RW 05", "RT 03 RW 05", "rt 02")
 *   landmark— "depan balai desa" (patokan: depan/dekat/samping/seberang/di sebelah)
 *   coordinates — "-7.781, 110.360" (keyword-introduced or bare pair)
 *
 * `raw` is the normalized display string composed from the components.
 * Returns null when the text carries no recognizable location component —
 * notably for anaphoric mentions ("di sana", "di situ"), which must NEVER be
 * stored as a literal location (see isAnaphoricLocation).
 */
export interface ParsedLocation {
  raw: string;
  street?: string;
  hamlet?: string;
  rt?: string;
  rw?: string;
  landmark?: string;
  coordinates?: string;
}

/** Words that describe damage/condition, never a street name. Guards the
 * generic "jalan X"/"gang X" capture so description text ("jalan berlubang
 * besar…") is not misread as a street. */
const STREET_DESCRIPTOR_STOPLIST = new Set([
  'rusak', 'berlubang', 'hancur', 'amblas', 'patah', 'retak', 'tergenang',
  'banjir', 'kotor', 'macet', 'gelap', 'mati', 'padam', 'putus', 'bocor',
  'mampet', 'tersumbat', 'longsor', 'roboh', 'bolong', 'licin', 'becek',
  'penuh', 'menumpuk', 'berdebu', 'terjal',
]);

/** Cut a captured location fragment at the next component marker or at
 * punctuation/newline, then trim trailing punctuation. */
function cutLocationFragment(s: string): string {
  const cut = s.split(/[,;\n]/)[0];
  const marker = cut.search(/\s+(?:di\s+)?(?:depan|dekat|samping|seberang|dusun|rt|rw|koordinat)\b/i);
  const head = marker >= 0 ? cut.slice(0, marker) : cut;
  return head.replace(/[.,;:\s]+$/g, '').trim();
}

function normalizeDecimalComma(s: string): string {
  return s.replace(',', '.');
}

function parseCoordinatePair(latRaw: string, lonRaw: string): string | null {
  const lat = parseFloat(normalizeDecimalComma(latRaw));
  const lon = parseFloat(normalizeDecimalComma(lonRaw));
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  // Indonesia bounding box — rejects prices, phone fragments, etc.
  if (lat < -11 || lat > 6 || lon < 94 || lon > 142) return null;
  return `${normalizeDecimalComma(latRaw)}, ${normalizeDecimalComma(lonRaw)}`;
}

export function parseLocation(text: string): ParsedLocation | null {
  const t = text.trim();
  if (!t) return null;

  // 1. Coordinates (highest priority — unambiguous when valid).
  const introCoord = t.match(
    /\b(?:koordinat|titik\s*koordinat|lat(?:itude)?|long(?:itude)?|lintang|bujur)\b\s*[:\-]?\s*(-?\d{1,3}(?:[.,]\d+)?)\s*[,;]\s*(-?\d{1,3}(?:[.,]\d+)?)/i,
  );
  if (introCoord) {
    const coords = parseCoordinatePair(introCoord[1], introCoord[2]);
    if (coords) return { raw: coords, coordinates: coords };
  }
  const bareCoord = t.match(/(-?\d{1,2}[.,]\d+)\s*[,;]\s*(-?\d{2,3}[.,]\d+)/);
  if (bareCoord) {
    const coords = parseCoordinatePair(bareCoord[1], bareCoord[2]);
    if (coords) return { raw: coords, coordinates: coords };
  }

  // 2. Landmark / patokan.
  const landmarkM = t.match(
    /\b((?:di\s+sebelah|depan|dekat|samping|seberang)\s+[^,;\n]{2,60})/i,
  );
  const landmark = landmarkM ? cutLocationFragment(landmarkM[1]) : undefined;

  // 3. RT/RW — pair (slash optional) or lone.
  let rt: string | undefined; let rw: string | undefined; let rtRwSeg: string | undefined;
  const pair = t.match(/\brt\s*(\d{1,3})\s*\/?\s*rw\s*(\d{1,3})/i);
  if (pair) {
    rt = pair[1].padStart(2, '0'); rw = pair[2].padStart(2, '0');
    rtRwSeg = pair[0].trim(); // keep as written ("RT 02/RW 05" / "RT 03 RW 05")
  } else {
    const loneRt = t.match(/\brt\s*(\d{1,3})\b/i);
    const loneRw = t.match(/\brw\s*(\d{1,3})\b/i);
    if (loneRt) { rt = loneRt[1].padStart(2, '0'); rtRwSeg = `RT ${rt}`; }
    if (loneRw) { rw = loneRw[1].padStart(2, '0'); rtRwSeg = rtRwSeg ? `${rtRwSeg}/RW ${rw}` : `RW ${rw}`; }
  }

  // 4. Dusun (hamlet).
  const dusunM = t.match(/\b(dusun)\s+([a-zA-Z][\w.\s]{1,30})/i);
  const hamlet = dusunM ? cutLocationFragment(dusunM[2]) : undefined;
  const dusunSeg = dusunM && hamlet ? `${dusunM[1]} ${hamlet}` : undefined;

  // 5. Street — specific "jl." first, then generic "jalan"/"gang".
  // The generic form is rejected when its head word is a damage/condition
  // descriptor ("jalan berlubang…") so description text is never stored as
  // a street name.
  let street: string | undefined;
  const jlM = t.match(/\b(jl\.?)\s+([a-zA-Z][\w.\s]{1,40})/i);
  if (jlM) {
    const name = cutLocationFragment(jlM[2]);
    if (name) street = `${jlM[1]} ${name}`;
  } else {
    const genM = t.match(/\b(jalan|gang)\s+([a-zA-Z][\w.\s]{1,40})/i);
    if (genM) {
      const name = cutLocationFragment(genM[2]);
      const head = name.split(/\s+/)[0]?.toLowerCase() ?? '';
      if (name && !STREET_DESCRIPTOR_STOPLIST.has(head)) {
        street = `${genM[1]} ${name}`;
      }
    }
  }

  if (!street && !dusunSeg && !rtRwSeg && !landmark) return null;

  const parts: string[] = [];
  if (street) parts.push(street);
  if (dusunSeg) parts.push(dusunSeg);
  if (rtRwSeg) parts.push(rtRwSeg);
  if (landmark) parts.push(`(${landmark})`);
  return {
    raw: parts.join(', '),
    ...(street ? { street } : {}),
    ...(hamlet ? { hamlet } : {}),
    ...(rt ? { rt } : {}),
    ...(rw ? { rw } : {}),
    ...(landmark ? { landmark } : {}),
  };
}

/**
 * P1-10: anaphoric location mention ("di sana", "di situ") — a bare
 * deictic with no resolvable referent. parseLocation already returns null
 * for these; this helper lets the pipeline ask a targeted follow-up
 * instead of looping on the generic location prompt.
 */
export function isAnaphoricLocation(text: string): boolean {
  const t = text.toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, ' ').replace(/\s+/g, ' ').trim();
  return /^(di\s+)?(sana|situ)$/.test(t) || /^(sana|situ)\s+(tadi|itu)$/.test(t);
}

/** The message explicitly talks ABOUT the location slot (correction path). */
const EXPLICIT_LOCATION_MENTION_RE = /\b(lokasi|lokasinya|alamat|alamatnya|tempat\s+kejadian|posisi)\b/i;
/** The message explicitly talks ABOUT the description slot (correction path). */
const EXPLICIT_DESCRIPTION_MENTION_RE = /\b(deskripsi|deskripsinya|kronologi|kejadiannya)\b/i;
/** The message explicitly talks ABOUT the category slot (correction path). */
const EXPLICIT_CATEGORY_MENTION_RE = /\b(kategori|kategorinya|jenis\s+laporan)\b/i;
/** Leading correction phrasing stripped before storing a corrected value. */
const CORRECTION_PREFIX_RE =
  /^(?:(?:salah|keliru|maaf|tolong)[,.\s]*)?(?:ubah|rubah|perbaiki|koreksi|revisi|edit|ganti)\s+(?:deskripsinya|deskripsi|lokasinya|lokasi|alamatnya|alamat|kategorinya|kategori)\s*[:.,]?\s*/i;

function stripCorrectionPrefix(s: string): string {
  return s.replace(CORRECTION_PREFIX_RE, '').trim();
}

/**
 * Deterministic keyword extraction for the most common slots (best-effort).
 *
 * P1-10 slot-state rules (the FSM is the authority — the model never writes
 * slots directly):
 * - A slot that is already filled is NEVER overwritten by a generic keyword
 *   hit from an unrelated answer. Reproduction of the old bug: answering the
 *   description question with "jalan berlubang besar di tengah jalan" used to
 *   clobber the previously recorded location; now the location survives and
 *   the text lands in `description`.
 * - Overwrite happens only when (a) the message targets that slot
 *   (`expectedSlot`), or (b) the message explicitly mentions the slot
 *   ("lokasinya di …", "ubah deskripsinya: …") — the correction path.
 * - Missing slots are still filled opportunistically (one-shot messages).
 */
export function extractSlotsDeterministic(
  text: string,
  intent: SlotIntent,
  /** Name of the slot the FSM is currently asking for (from nextMissingSlot). */
  expectedSlot?: string | null,
  /** Already-recorded slots — drives the never-clobber rule above. */
  existing?: Slots,
): Partial<Slots> {
  const out: Partial<Slots> = {};
  const lower = text.toLowerCase();
  if (intent === 'complaint') {
    const catKeywords: Array<[RegExp, string]> = [
      [/(jalan.*rusak|rusak.*jalan|berlubang)/, 'jalan rusak'],
      [/sampah/, 'sampah'],
      [/(air.*mati|mati.*air|pdam|kekeringan)/, 'air bersih'],
      [/(lampu.*mati|penerangan|gelap)/, 'penerangan jalan'],
      [/(banjir|genangan)/, 'banjir'],
    ];
    // Category: fill when missing; overwrite only when targeted or explicit.
    if (!existing?.category || expectedSlot === 'category' || EXPLICIT_CATEGORY_MENTION_RE.test(text)) {
      for (const [re, cat] of catKeywords) {
        if (re.test(lower)) { out.category = cat; break; }
      }
    }
    // Location: structured parse (jalan/dusun/rt-rw/patokan/koordinat).
    const parsed = parseLocation(text);
    const locFilled = !!existing?.location;
    const locTargeted = expectedSlot === 'location' || EXPLICIT_LOCATION_MENTION_RE.test(text);
    if (parsed && (!locFilled || locTargeted)) {
      out.location = parsed.raw;
    }
    // Description: when the FSM is asking for it, the user's free-text answer
    // IS the description (unless it was clearly a location fragment, or an
    // explicit location mention that targeted the location slot instead).
    // Also honored on explicit correction ("ubah deskripsinya: …").
    // Validation (min 10 chars) happens in mergeSlots.
    const descTargeted = expectedSlot === 'description' || EXPLICIT_DESCRIPTION_MENTION_RE.test(text);
    if (descTargeted && !parsed && text.trim().length >= 4) {
      out.description = stripCorrectionPrefix(text.trim());
    }
  }
  return out;
}

/** Merge newly extracted values into existing slots (new values win if valid). */
export function mergeSlots(
  intent: SlotIntent, existing: Slots, incoming: Record<string, unknown>,
): { slots: Slots; errors: Array<{ slot: string; error: string }> } {
  const schema = SLOT_SCHEMAS[intent];
  const slots: Slots = { ...existing };
  const errors: Array<{ slot: string; error: string }> = [];
  for (const def of schema) {
    const raw = incoming[def.name];
    if (raw === undefined || raw === null || String(raw).trim() === '') continue;
    const res = def.validate(String(raw));
    if (res.ok) {
      if (res.value !== '') slots[def.name] = res.value;
    } else {
      errors.push({ slot: def.name, error: res.error });
    }
  }
  return { slots, errors };
}

/** First required slot that is still empty, or null when COLLECT is complete.
 * P1-10: only REQUIRED slots gate completion — optional slots (required:
 * false) never block the flow. */
export function nextMissingSlot(intent: SlotIntent, slots: Slots): SlotDef | null {
  for (const def of SLOT_SCHEMAS[intent]) {
    if (def.required && !slots[def.name]) return def;
  }
  return null;
}

/** True when all required slots are filled. */
export function isCollectComplete(intent: SlotIntent, slots: Slots): boolean {
  return nextMissingSlot(intent, slots) === null;
}

/** P1-10: names of the REQUIRED slots for an intent — the exact set that
 * gates COLLECT completion. Optional slots are never required. */
export function getRequiredSlotNames(intent: SlotIntent): string[] {
  return SLOT_SCHEMAS[intent].filter((d) => d.required).map((d) => d.name);
}

/**
 * Deterministic VERIFY summary. Rendered by code, never by the model —
 * the citizen confirms exactly what the system recorded.
 * P1-10: optional slots are explicitly marked "(opsional)" so the citizen
 * can tell required from optional at a glance.
 */
export function renderVerifySummary(intent: SlotIntent, slots: Slots): string {
  const lines = SLOT_SCHEMAS[intent]
    .filter((d) => slots[d.name])
    .map((d) => `• ${d.label}${d.required ? '' : ' (opsional)'}: ${slots[d.name]}`);
  const title = intent === 'complaint' ? 'laporan' : 'permohonan';
  return [
    `Mohon periksa kembali ${title} Anda:`,
    '',
    ...lines,
    '',
    'Apakah data di atas sudah benar? Balas *Ya, lanjutkan* untuk memproses, atau beri tahu bagian yang perlu diperbaiki.',
  ].join('\n');
}

/** Intent key stored inside slots so multi-turn COLLECT survives restarts. */
export const INTENT_SLOT_KEY = '_intent';
/** Counts COLLECT turns for the "2x gagal → handoff" rule. */
export const COLLECT_ATTEMPTS_KEY = '_collect_attempts';

/** Deterministic complaint-vs-service classifier (keyword based). */
export function classifySlotIntent(text: string): SlotIntent | null {
  const t = text.toLowerCase();
  const serviceHits = /\b(surat|ktp\b|kk\b|domisili|skck|sktm|pengantar|permohonan|daftar|urus|formulir)\b/.test(t);
  const complaintHits = /\b(lapor|aduan|rusak|bocor|sampah|jalan|jembatan|lampu|air|banjir|kotor|mati|berlubang)\b/.test(t);
  if (serviceHits && !complaintHits) return 'service_request';
  if (complaintHits && !serviceHits) return 'complaint';
  return null; // ambiguous → stays in TRIAGE, never guessed
}

/**
 * Service-confirmation detector for ambiguous COLLECT turns (C2 parity with v1).
 * When the user affirms ("ok saya mau bikin") after service info was discussed,
 * and classifySlotIntent returned null, prefer 'service_request' over the
 * 'complaint' default. Matches v1's pending-offer confirmation patterns.
 */
export function isServiceConfirmation(text: string): boolean {
  const t = text.trim().toLowerCase().replace(/\s+/g, ' ');
  return (
    /^(ok|oke|ya|iya|siap|boleh)\s+(saya\s+)?mau\s+(bikin|buat|lanjut|aju(kan)?|proses|daftar)/i.test(t) ||
    /^saya\s+mau\s+(bikin|buat|lanjut|aju(kan)?)/i.test(t) ||
    /^(ya|iya)\s+(mau|boleh)\b/i.test(t)
  );
}

/**
 * Explicit confirmation detectors (button payloads or typed text).
 *
 * P0-1: also matches the confirm-button TITLES sent by wa-interactive
 * (e.g. "✅ Benar, kirim") — emoji/punctuation are stripped before matching.
 * NOTE: matching here only means "affirmative intent". It NEVER authorizes a
 * mutation by itself; execution requires `confirmed` bound to a button.id via
 * bindConfirmation (pipeline/confirmation.ts).
 */
export function isExplicitConfirmation(text: string): boolean {
  const t = text.trim().toLowerCase()
    .replace(/[^\p{L}\p{N}\s,]/gu, '')
    .replace(/\s+/g, ' ')
    .trim();
  return /^(ya|ya,? lanjutkan|setuju|benar(, kirim)?|betul|ok|oke|lanjut|lanjutkan|proses)[.!]*$/.test(t);
}

export function isCancellation(text: string): boolean {
  return /\b(batal|batalkan|gak jadi|nggak jadi|tidak jadi|cancel)\b/i.test(text);
}

export function isCorrectionRequest(text: string): boolean {
  return /\b(ubah|rubah|perbaiki|salah|keliru|koreksi|revisi|edit)\b/i.test(text);
}

export interface PendingMutation {
  tool: string;
  args: Record<string, unknown>;
}

/**
 * Deterministic mutation planner: slots → concrete tool call.
 * Returns null when required data is missing (caller must failover, never guess).
 */
export function buildPendingMutation(intent: SlotIntent, slots: Slots): PendingMutation | null {
  if (intent === 'complaint') {
    if (!slots.description) return null;
    // P1-10: RT/RW accepted with or without slash ("RT 02/RW 05",
    // "RT 03 RW 05", lone "RT 02"); normalized to the slashed form.
    const rtRwM = slots.location?.match(/\brt\s*(\d{1,3})\s*\/?\s*rw\s*(\d{1,3})/i);
    const rtRw = rtRwM ? `RT ${rtRwM[1].padStart(2, '0')}/RW ${rtRwM[2].padStart(2, '0')}` : null;
    return {
      tool: 'create_complaint',
      args: {
        kategori: slots.category ?? null,
        alamat: slots.location ?? null,
        deskripsi: slots.description,
        rt_rw: rtRw,
        nama_pelapor: slots.reporter_name ?? null,
        no_hp: null,
      },
    };
  }
  // service_request → the tool prepares an official online form link.
  if (!slots.service_slug) return null;
  return {
    tool: 'create_service_request',
    args: { service_slug: slots.service_slug },
  };
}
