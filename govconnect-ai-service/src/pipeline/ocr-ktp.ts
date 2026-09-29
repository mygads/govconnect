/**
 * R14 — KTP OCR pre-fill client.
 *
 * Calls the on-prem ocr-service sidecar (PaddleOCR, CPU) to extract KTP
 * fields from a citizen-sent photo. The result is UNVERIFIED input:
 *
 *  - fields below OCR_MIN_CONFIDENCE (default 0.6) are dropped,
 *  - NIK must be exactly 16 digits or it is dropped,
 *  - tanggal_lahir must parse as DD-MM-YYYY or it is dropped,
 *  - surviving fields PRE-FILL slots / identity candidates only,
 *  - everything pre-filled must be shown to the citizen for EXPLICIT G2
 *    confirmation before any mutation or PII-vault write,
 *  - the raw image is NEVER sent to any cloud service (sidecar only),
 *  - OCR field values are never logged.
 *
 * Never throws: failures return null so the pipeline can fall back to
 * asking the citizen to type the data manually.
 */

import logger from '../utils/logger';

export interface OcrField {
  value: string | null;
  confidence: number | null;
}

export interface OcrKtpResult {
  fields: Record<string, OcrField>;
  overallConfidence: number | null;
}

export function isOcrConfigured(): boolean {
  return (
    process.env.OCR_ENABLED === 'true' &&
    Boolean((process.env.OCR_API_URL ?? '').trim())
  );
}

export function getOcrMinConfidence(): number {
  const raw = Number(process.env.OCR_MIN_CONFIDENCE ?? '0.6');
  return Number.isFinite(raw) && raw > 0 && raw <= 1 ? raw : 0.6;
}

function ocrUrl(): string {
  return `${(process.env.OCR_API_URL ?? '').trim().replace(/\/+$/, '')}/ocr/ktp`;
}

/**
 * POST the image to the sidecar. Returns null on any failure (timeout,
 * HTTP error, engine 503, malformed response) — the caller falls back to
 * manual entry. Field values are never logged.
 */
export async function extractKtpFields(
  imageBytes: Buffer,
  timeoutMs = 25_000,
): Promise<OcrKtpResult | null> {
  if (!isOcrConfigured()) return null;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const form = new FormData();
    form.append('file', new Blob([imageBytes], { type: 'image/jpeg' }), 'ktp.jpg');
    const headers: Record<string, string> = {};
    const key = (process.env.OCR_API_KEY ?? '').trim();
    if (key) headers.Authorization = `Bearer ${key}`;
    const res = await fetch(ocrUrl(), {
      method: 'POST',
      headers,
      body: form,
      signal: ctrl.signal,
    });
    if (!res.ok) {
      logger.warn('[ocr-ktp] sidecar error', { status: res.status });
      return null;
    }
    const body = (await res.json()) as {
      fields?: Record<string, OcrField>;
      overall_confidence?: number | null;
    };
    if (!body || typeof body.fields !== 'object') {
      logger.warn('[ocr-ktp] malformed sidecar response');
      return null;
    }
    return {
      fields: body.fields,
      overallConfidence:
        typeof body.overall_confidence === 'number' ? body.overall_confidence : null,
    };
  } catch (err) {
    logger.warn('[ocr-ktp] sidecar unreachable', {
      error: String((err as Error)?.message ?? err).slice(0, 100),
    });
    return null;
  } finally {
    clearTimeout(timer);
  }
}

export interface ValidatedOcrField {
  field: string;
  value: string;
  confidence: number;
}

export interface OcrValidation {
  valid: ValidatedOcrField[];
  dropped: Array<{ field: string; reason: string }>;
}

function isRealDate(dd: string, mm: string, yyyy: string): boolean {
  const d = Number(dd);
  const m = Number(mm);
  const y = Number(yyyy);
  if (y < 1900 || y > 2100 || m < 1 || m > 12 || d < 1 || d > 31) return false;
  const dt = new Date(Date.UTC(y, m - 1, d));
  return (
    dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d
  );
}

/**
 * Pure validation: format + confidence gate. A field that fails is DROPPED,
 * never "fixed up" — the citizen types it manually instead.
 */
export function validateKtpFields(
  fields: Record<string, OcrField>,
  minConfidence = getOcrMinConfidence(),
): OcrValidation {
  const valid: ValidatedOcrField[] = [];
  const dropped: Array<{ field: string; reason: string }> = [];
  for (const [field, f] of Object.entries(fields)) {
    const value = (f?.value ?? '').trim();
    const conf = f?.confidence;
    if (!value) continue; // sidecar found nothing — not an error
    if (typeof conf !== 'number' || conf < minConfidence) {
      dropped.push({ field, reason: `keyakinan rendah (${conf ?? 'n/a'})` });
      continue;
    }
    if (field === 'nik') {
      const digits = value.replace(/\D/g, '');
      if (digits.length !== 16) {
        dropped.push({ field, reason: 'NIK bukan 16 digit' });
        continue;
      }
      valid.push({ field, value: digits, confidence: conf });
      continue;
    }
    if (field === 'tanggal_lahir') {
      const m = /^(\d{2})-(\d{2})-(\d{4})$/.exec(value);
      if (!m || !isRealDate(m[1]!, m[2]!, m[3]!)) {
        dropped.push({ field, reason: 'tanggal lahir tidak valid (DD-MM-YYYY)' });
        continue;
      }
      valid.push({ field, value, confidence: conf });
      continue;
    }
    valid.push({ field, value, confidence: conf });
  }
  return { valid, dropped };
}

/** OCR field → pipeline slot name. Only whitelisted slots are pre-filled. */
const SLOT_PREFILL_MAP: Record<string, string> = {
  nama: 'reporter_name',
};

export interface OcrIdentityCandidate {
  field: string;
  value: string;
  confidence: number;
  /** Never trusted raw: needs explicit G2 citizen confirmation. */
  ocrPrefilled: true;
  needsConfirmation: true;
}

export interface OcrPrefillOutcome {
  filledSlots: string[];
  identityCandidates: OcrIdentityCandidate[];
  dropped: Array<{ field: string; reason: string }>;
}

/**
 * Pre-fill pipeline slots from validated OCR fields. Only fills EMPTY slots;
 * never overwrites what the citizen already typed. Identity fields that have
 * no slot (nik, tanggal_lahir, …) become CANDIDATES under `_ocr_identity` —
 * visible to the agent for the G2 confirmation, but never a vault write.
 */
export function prefillSlotsFromKtp(
  slots: Record<string, unknown>,
  fields: Record<string, OcrField>,
  minConfidence = getOcrMinConfidence(),
): OcrPrefillOutcome {
  const { valid, dropped } = validateKtpFields(fields, minConfidence);
  const filledSlots: string[] = [];
  const identityCandidates: OcrIdentityCandidate[] = [];

  for (const f of valid) {
    const slotName = SLOT_PREFILL_MAP[f.field];
    if (slotName && (slots[slotName] === undefined || slots[slotName] === '')) {
      slots[slotName] = f.value;
      filledSlots.push(slotName);
    }
    // Identity candidates are ALWAYS recorded (even for mapped fields) so
    // the G2 confirmation can show provenance.
    identityCandidates.push({
      field: f.field,
      value: f.value,
      confidence: f.confidence,
      ocrPrefilled: true,
      needsConfirmation: true,
    });
  }

  if (identityCandidates.length > 0) {
    slots._ocr_identity = identityCandidates;
    slots._ocr_prefilled = identityCandidates.map((c) => c.field);
  }
  return { filledSlots, identityCandidates, dropped };
}

/** Turn fact so the agent presents pre-filled data for explicit confirmation. */
export function buildOcrPrefillFact(outcome: OcrPrefillOutcome): string {
  const shown = outcome.identityCandidates
    .map((c) => `${c.field} "${c.value}" (keyakinan ${Math.round(c.confidence * 100)}%)`)
    .join('; ');
  const dropped = outcome.dropped.length
    ? ` Tidak terbaca/ditolak: ${outcome.dropped.map((d) => `${d.field} (${d.reason})`).join('; ')} — minta warga mengetik manual.`
    : '';
  return (
    '[OCR KTP] Dari foto KTP terbaca (BELUM TERVERIFIKASI, hanya pre-fill): ' +
    shown +
    '.' +
    dropped +
    ' Tampilkan SEMUA data pre-fill ke warga dan minta konfirmasi eksplisit (tombol Ya/Ubah) ' +
    'sebelum dipakai untuk surat/laporan. JANGAN simpan NIK ke vault dari hasil OCR tanpa konfirmasi.'
  );
}
