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

/** Deterministic keyword extraction for the most common slots (best-effort). */
export function extractSlotsDeterministic(text: string, intent: SlotIntent): Partial<Slots> {
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
    for (const [re, cat] of catKeywords) {
      if (re.test(lower)) { out.category = cat; break; }
    }
    const rtRw = text.match(/\bRT\s*\d+\s*\/\s*RW\s*\d+/i);
    if (rtRw) out.location = rtRw[0].toUpperCase();
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

/** First required slot that is still empty, or null when COLLECT is complete. */
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

/**
 * Deterministic VERIFY summary. Rendered by code, never by the model —
 * the citizen confirms exactly what the system recorded.
 */
export function renderVerifySummary(intent: SlotIntent, slots: Slots): string {
  const lines = SLOT_SCHEMAS[intent]
    .filter((d) => slots[d.name])
    .map((d) => `• ${d.label}: ${slots[d.name]}`);
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

/** Explicit confirmation detectors (button payloads or typed text). */
export function isExplicitConfirmation(text: string): boolean {
  return /^(ya|ya[,.]?\s*lanjutkan|setuju|benar|betul|ok|oke|lanjut|proses)(\s*[.!]*)?$/i.test(text.trim());
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
    const rtRw = slots.location?.match(/\bRT\s*\d+\s*\/\s*RW\s*\d+/i)?.[0]?.toUpperCase() ?? null;
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
