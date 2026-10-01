/**
 * Model Compatibility Test Service
 *
 * Menjalankan test capability terhadap sebuah LLM untuk menilai
 * apakah model tersebut kompatibel dengan kebutuhan GovConnect.
 *
 * Latar belakang: model free `stealth/space-bunny-alpha` terbukti tidak
 * kompatibel (teks garbled, name extraction gagal total). Super admin
 * butuh cara test model baru SEBELUM menjadikannya primary.
 *
 * Test suite:
 * - 5 basic tests (bobot 1x): chat, JSON, vision, latency, token usage
 * - 6 smartness tests (bobot 2x): GovConnect-specific mini cases
 *   Jika gagal >2 smartness tests → otomatis TIDAK KOMPATIBEL.
 */

import logger from '../utils/logger';
import prisma from '../lib/prisma';
import { decryptSecret } from '../utils/crypto';
import { sanitizeProviderDefaultHeaders } from '../utils/provider-headers';
import { config } from '../config/env';

// ── Types ──────────────────────────────────────────────────────────────

export type CompatTestStatus = 'PASS' | 'FAIL' | 'SKIP';

export interface CompatTestResult {
  test_id: string;
  test_name: string;
  status: CompatTestStatus;
  latency_ms: number;
  input_tokens: number;
  output_tokens: number;
  reason: string;
  raw_preview?: string;
  /** Bobot test: basic=1, smartness=2 */
  weight: number;
  /** true jika ini smartness test */
  is_smartness: boolean;
}

export type CompatRecommendation = 'KOMPATIBEL' | 'SEBAGIAN' | 'TIDAK KOMPATIBEL';

export interface CompatibilityReport {
  model: string;
  provider: string;
  provider_slug: string;
  tested_at: string;
  results: CompatTestResult[];
  passed: number;
  failed: number;
  skipped: number;
  total: number;
  /** Skor berbobot: "X/Y" */
  score: string;
  /** Jumlah smartness tests yang gagal */
  smartness_failed: number;
  smartness_total: number;
  recommendation: CompatRecommendation;
  total_latency_ms: number;
  total_input_tokens: number;
  total_output_tokens: number;
}

export interface CompatTestTarget {
  base_url: string;
  api_key: string;
  model_name: string;
  endpoint_path?: string | null;
  supports_vision?: boolean;
  provider_name?: string;
  provider_slug?: string;
  default_headers_json?: unknown;
}

// ── Helpers ────────────────────────────────────────────────────────────

function joinUrl(baseUrl: string, endpointPath: string): string {
  return `${baseUrl.replace(/\/+$/, '')}/${(endpointPath || '').replace(/^\/+/, '')}`;
}

/** Deteksi teks garbled: karakter CJK/Arab berlebihan dalam respons Bahasa Indonesia. */
function detectGarbled(text: string): { garbled: boolean; reason: string } {
  if (!text || text.length < 10) return { garbled: true, reason: 'Respons terlalu pendek/kosong' };
  // Hitung karakter CJK (Han, Hiragana, Katakana, Hangul)
  const cjk = (text.match(/[\u4e00-\u9fff\u3040-\u30ff\uac00-\ud7af]/g) || []).length;
  const ratio = cjk / text.length;
  if (ratio > 0.05) {
    return { garbled: true, reason: `Terdeteksi ${cjk} karakter CJK (${(ratio * 100).toFixed(1)}%) — kemungkinan teks garbled` };
  }
  // Deteksi pola aneh: kata tersambung dengan tanda kurung aneh, dsb
  const weirdPatterns = (text.match(/\([a-z]+\)|[a-z]{30,}/gi) || []).length;
  if (weirdPatterns > 2) {
    return { garbled: true, reason: 'Terdeteksi pola teks aneh (kata tidak wajar)' };
  }
  return { garbled: false, reason: '' };
}

/** Cek apakah teks mengandung Bahasa Indonesia yang wajar. */
function looksIndonesian(text: string): boolean {
  const idWords = ['yang', 'dan', 'saya', 'anda', 'dengan', 'untuk', 'dari', 'ini', 'itu', 'adalah', 'tidak', 'bisa', 'akan', 'kami', 'kabar', 'baik', 'terima', 'kasih', 'desa', 'layanan'];
  const lower = text.toLowerCase();
  const hits = idWords.filter((w) => lower.includes(w)).length;
  return hits >= 2;
}

interface ChatCallResult {
  content: string;
  inputTokens: number;
  outputTokens: number;
  latencyMs: number;
}

async function callChat(
  target: CompatTestTarget,
  messages: Array<{ role: string; content: any }>,
  opts?: { maxTokens?: number; temperature?: number; timeoutMs?: number },
): Promise<ChatCallResult> {
  const timeoutMs = opts?.timeoutMs || 60000;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  const start = Date.now();
  const url = joinUrl(target.base_url, target.endpoint_path || '/chat/completions');
  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${target.api_key}`,
        ...sanitizeProviderDefaultHeaders(target.default_headers_json),
      },
      body: JSON.stringify({
        model: target.model_name,
        messages,
        temperature: opts?.temperature ?? 0,
        max_tokens: opts?.maxTokens ?? 200,
      }),
      signal: controller.signal,
    });
    const payload = (await response.json().catch(() => ({}))) as any;
    if (!response.ok) {
      throw new Error(payload?.error?.message || payload?.error || `HTTP ${response.status}`);
    }
    const choice = payload?.choices?.[0];
    const content = choice?.message?.content || choice?.text || '';
    return {
      content: typeof content === 'string' ? content : JSON.stringify(content),
      inputTokens: payload?.usage?.prompt_tokens || 0,
      outputTokens: payload?.usage?.completion_tokens || 0,
      latencyMs: Date.now() - start,
    };
  } catch (error: any) {
    const message = error?.name === 'AbortError'
      ? `Timeout setelah ${timeoutMs}ms`
      : error?.message || 'Request gagal';
    throw new Error(message);
  } finally {
    clearTimeout(timeout);
  }
}

// ── Test cases ─────────────────────────────────────────────────────────

const NAME_EXTRACTION_TEST_PROMPT = `Kamu adalah extractor nama untuk layanan publik Indonesia (GovConnect).

TUGAS:
Dari pesan user, tentukan apakah user menyebutkan NAMANYA SENDIRI. Jika ya, ekstrak nama tersebut.

ATURAN:
- Hanya ekstrak nama ORANG (bukan nama tempat/instansi/layanan).
- Nama valid: minimal 2 karakter, huruf alfabet.
- Jika user menjawab pertanyaan "siapa nama Anda?", anggap jawaban sebagai nama.

OUTPUT (JSON saja, tanpa teks lain):
{
  "name": "nama atau null",
  "confidence": 0.0-1.0,
  "is_name_statement": true/false
}

Pesan user: "Nama saya Budi Santoso"
`;

const INTENT_TEST_PROMPT = `Kamu adalah classifier intent untuk layanan publik desa Indonesia (GovConnect).

Klasifikasikan pesan user berikut ke SALAH SATU intent:
- GREETING: sapaan (halo, assalamualaikum, selamat pagi)
- SERVICE_INFO: bertanya syarat/biaya/prosedur layanan administrasi (KTP, KK, surat)
- CREATE_COMPLAINT: ingin melapor/mengeluh tentang masalah (jalan rusak, lampu mati, sampah)
- CHECK_STATUS: menanyakan status laporan dengan nomor tiket
- CONTACT_INFO: bertanya nomor kontak/pejabat desa
- OUT_OF_DOMAIN: di luar urusan desa

OUTPUT (JSON saja, tanpa teks lain):
{"intent": "NAMA_INTENT", "confidence": 0.0-1.0}

Pesan user: "saya mau lapor jalan rusak di rt 05"
`;

// ── Smartness test prompts (GovConnect-specific) ──

const SMART_JAVANESE_PROMPT = `Pesan berikut ditulis dalam Bahasa Jawa (ngoko).

TUGAS: Pahami maksud user dan jawab dalam JSON saja:
{"topik": "topik utama yang diinginkan user dalam Bahasa Indonesia", "bahasa": "jawa"}

Pesan: "pak, badhe ndamel KTP, syarate napa mawon?"
`;

const SMART_ABBREVIATION_PROMPT = `Dalam konteks layanan administrasi desa di Indonesia, apa kepanjangan dari singkatan "SKU"?

Jawab HANYA dengan JSON:
{"kepanjangan": "..."}
`;

const SMART_INTENT_MULTI_PROMPT = `Klasifikasikan masing-masing dari 3 pesan berikut ke SALAH SATU:
GREETING, SERVICE_INFO, CREATE_COMPLAINT, CHECK_STATUS, CONTACT_INFO, OUT_OF_DOMAIN.

Jawab HANYA dengan JSON array:
[{"pesan": "pesan asli", "intent": "INTENT"}, {"pesan": "...", "intent": "..."}, {"pesan": "...", "intent": "..."}]

Pesan 1: "jalan depan rumah saya rusak parah"
Pesan 2: "syarat bikin KTP apa?"
Pesan 3: "halo"
`;

const SMART_REFUSAL_PROMPT = `Kamu adalah AI asisten layanan desa Indonesia (GovConnect).

User bertanya: "bisa perpanjang SIM di desa?"

FAKTA: SIM (Surat Izin Mengemudi) diterbitkan oleh Polri (Satpas/Samsat), BUKAN layanan desa. Desa tidak bisa memproses perpanjangan SIM.

Jawab jujur dalam Bahasa Indonesia, maksimal 2 kalimat. Jangan mengarang prosedur.
`;

const SMART_COMPLEX_PROMPT = `Ekstrak informasi dari pesan user berikut.

Jawab HANYA dengan JSON:
{"nama": "nama pelapor atau null", "kategori": "kategori masalah", "lokasi": "lokasi atau null"}

Pesan: "Saya mau lapor lampu mati di RT 05, nama saya Andi"
`;

const JSON_STRICT_PROMPT = `Balas HANYA dengan JSON valid, tanpa teks lain:

{"layanan": "KTP Baru", "estimasi_hari": 14, "biaya": "Gratis", "syarat": ["KK", "Surat pengantar RT"]}
`;

// 1x1 red PNG untuk test vision
const TEST_IMAGE_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

function basicResult(test_id: string, test_name: string, partial: Omit<CompatTestResult, 'test_id' | 'test_name' | 'weight' | 'is_smartness'>): CompatTestResult {
  return { test_id, test_name, weight: 1, is_smartness: false, ...partial };
}

function smartResult(test_id: string, test_name: string, partial: Omit<CompatTestResult, 'test_id' | 'test_name' | 'weight' | 'is_smartness'>): CompatTestResult {
  return { test_id, test_name, weight: 2, is_smartness: true, ...partial };
}

async function testBasicChat(target: CompatTestTarget): Promise<CompatTestResult> {
  const testId = 'basic_chat_id';
  const testName = 'Basic Chat (ID)';
  try {
    const r = await callChat(target, [
      { role: 'user', content: 'Halo, apa kabar?' },
    ], { maxTokens: 150 });
    const garbled = detectGarbled(r.content);
    if (garbled.garbled) {
      return basicResult(testId, testName, { status: 'FAIL', latency_ms: r.latencyMs, input_tokens: r.inputTokens, output_tokens: r.outputTokens, reason: garbled.reason, raw_preview: r.content.substring(0, 200) });
    }
    if (!looksIndonesian(r.content)) {
      return basicResult(testId, testName, { status: 'FAIL', latency_ms: r.latencyMs, input_tokens: r.inputTokens, output_tokens: r.outputTokens, reason: 'Respons tidak terlihat seperti Bahasa Indonesia', raw_preview: r.content.substring(0, 200) });
    }
    return basicResult(testId, testName, { status: 'PASS', latency_ms: r.latencyMs, input_tokens: r.inputTokens, output_tokens: r.outputTokens, reason: 'Respons Bahasa Indonesia koheren', raw_preview: r.content.substring(0, 200) });
  } catch (e: any) {
    return basicResult(testId, testName, { status: 'FAIL', latency_ms: 0, input_tokens: 0, output_tokens: 0, reason: `Error: ${e.message}` });
  }
}

async function testNameExtraction(target: CompatTestTarget): Promise<CompatTestResult> {
  const testId = 'smart_name_id';
  const testName = 'Ekstraksi Nama Indonesia';
  try {
    const r = await callChat(target, [
      { role: 'user', content: NAME_EXTRACTION_TEST_PROMPT },
    ], { maxTokens: 150 });
    const jsonMatch = r.content.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      return smartResult(testId, testName, { status: 'FAIL', latency_ms: r.latencyMs, input_tokens: r.inputTokens, output_tokens: r.outputTokens, reason: 'Respons bukan JSON', raw_preview: r.content.substring(0, 200) });
    }
    let parsed: any;
    try {
      parsed = JSON.parse(jsonMatch[0]);
    } catch {
      return smartResult(testId, testName, { status: 'FAIL', latency_ms: r.latencyMs, input_tokens: r.inputTokens, output_tokens: r.outputTokens, reason: 'JSON tidak valid', raw_preview: r.content.substring(0, 200) });
    }
    const name = typeof parsed.name === 'string' ? parsed.name.trim().toLowerCase() : '';
    if (name === 'budi santoso' && parsed.is_name_statement === true) {
      return smartResult(testId, testName, { status: 'PASS', latency_ms: r.latencyMs, input_tokens: r.inputTokens, output_tokens: r.outputTokens, reason: 'Nama "Budi Santoso" terekstrak persis', raw_preview: r.content.substring(0, 200) });
    }
    return smartResult(testId, testName, { status: 'FAIL', latency_ms: r.latencyMs, input_tokens: r.inputTokens, output_tokens: r.outputTokens, reason: `Ekstraksi salah: name="${parsed.name}", is_name_statement=${parsed.is_name_statement}`, raw_preview: r.content.substring(0, 200) });
  } catch (e: any) {
    return smartResult(testId, testName, { status: 'FAIL', latency_ms: 0, input_tokens: 0, output_tokens: 0, reason: `Error: ${e.message}` });
  }
}

async function testJsonStructured(target: CompatTestTarget): Promise<CompatTestResult> {
  const testId = 'json_structured';
  const testName = 'JSON Structured Output';
  try {
    const r = await callChat(target, [
      { role: 'user', content: JSON_STRICT_PROMPT },
    ], { maxTokens: 150 });
    const jsonMatch = r.content.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      return basicResult(testId, testName, { status: 'FAIL', latency_ms: r.latencyMs, input_tokens: r.inputTokens, output_tokens: r.outputTokens, reason: 'Respons bukan JSON', raw_preview: r.content.substring(0, 200) });
    }
    let parsed: any;
    try {
      parsed = JSON.parse(jsonMatch[0]);
    } catch {
      return basicResult(testId, testName, { status: 'FAIL', latency_ms: r.latencyMs, input_tokens: r.inputTokens, output_tokens: r.outputTokens, reason: 'JSON tidak valid (parse gagal)', raw_preview: r.content.substring(0, 200) });
    }
    if (parsed.layanan && typeof parsed.estimasi_hari === 'number') {
      return basicResult(testId, testName, { status: 'PASS', latency_ms: r.latencyMs, input_tokens: r.inputTokens, output_tokens: r.outputTokens, reason: 'JSON valid dengan field yang benar', raw_preview: r.content.substring(0, 200) });
    }
    return basicResult(testId, testName, { status: 'FAIL', latency_ms: r.latencyMs, input_tokens: r.inputTokens, output_tokens: r.outputTokens, reason: 'JSON valid tapi field tidak sesuai', raw_preview: r.content.substring(0, 200) });
  } catch (e: any) {
    return basicResult(testId, testName, { status: 'FAIL', latency_ms: 0, input_tokens: 0, output_tokens: 0, reason: `Error: ${e.message}` });
  }
}

async function testVision(target: CompatTestTarget): Promise<CompatTestResult> {
  const testId = 'vision';
  const testName = 'Vision / Image';
  if (!target.supports_vision) {
    return basicResult(testId, testName, { status: 'SKIP', latency_ms: 0, input_tokens: 0, output_tokens: 0, reason: 'Model tidak declare supports_vision' });
  }
  try {
    const r = await callChat(target, [
      {
        role: 'user',
        content: [
          { type: 'text', text: 'Describe this image in one short Indonesian sentence.' },
          { type: 'image_url', image_url: { url: `data:image/png;base64,${TEST_IMAGE_BASE64}` } },
        ],
      },
    ], { maxTokens: 100 });
    const garbled = detectGarbled(r.content);
    if (garbled.garbled) {
      return basicResult(testId, testName, { status: 'FAIL', latency_ms: r.latencyMs, input_tokens: r.inputTokens, output_tokens: r.outputTokens, reason: garbled.reason, raw_preview: r.content.substring(0, 200) });
    }
    if (r.content.length < 5) {
      return basicResult(testId, testName, { status: 'FAIL', latency_ms: r.latencyMs, input_tokens: r.inputTokens, output_tokens: r.outputTokens, reason: 'Respons vision kosong', raw_preview: r.content.substring(0, 200) });
    }
    return basicResult(testId, testName, { status: 'PASS', latency_ms: r.latencyMs, input_tokens: r.inputTokens, output_tokens: r.outputTokens, reason: 'Model merespons input gambar', raw_preview: r.content.substring(0, 200) });
  } catch (e: any) {
    return basicResult(testId, testName, { status: 'FAIL', latency_ms: 0, input_tokens: 0, output_tokens: 0, reason: `Error: ${e.message}` });
  }
}

// ── Smartness tests (GovConnect-specific, bobot 2x) ──

async function testSmartJavanese(target: CompatTestTarget): Promise<CompatTestResult> {
  const testId = 'smart_javanese';
  const testName = 'Bahasa Daerah (Jawa)';
  try {
    const r = await callChat(target, [{ role: 'user', content: SMART_JAVANESE_PROMPT }], { maxTokens: 100 });
    const jsonMatch = r.content.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      return smartResult(testId, testName, { status: 'FAIL', latency_ms: r.latencyMs, input_tokens: r.inputTokens, output_tokens: r.outputTokens, reason: 'Respons bukan JSON', raw_preview: r.content.substring(0, 200) });
    }
    let parsed: any;
    try { parsed = JSON.parse(jsonMatch[0]); } catch {
      return smartResult(testId, testName, { status: 'FAIL', latency_ms: r.latencyMs, input_tokens: r.inputTokens, output_tokens: r.outputTokens, reason: 'JSON tidak valid', raw_preview: r.content.substring(0, 200) });
    }
    const topik = String(parsed.topik || '').toLowerCase();
    if (topik.includes('ktp')) {
      return smartResult(testId, testName, { status: 'PASS', latency_ms: r.latencyMs, input_tokens: r.inputTokens, output_tokens: r.outputTokens, reason: `Paham Bahasa Jawa → topik "${parsed.topik}"`, raw_preview: r.content.substring(0, 200) });
    }
    return smartResult(testId, testName, { status: 'FAIL', latency_ms: r.latencyMs, input_tokens: r.inputTokens, output_tokens: r.outputTokens, reason: `Tidak paham: topik="${parsed.topik}" (expected mengandung KTP)`, raw_preview: r.content.substring(0, 200) });
  } catch (e: any) {
    return smartResult(testId, testName, { status: 'FAIL', latency_ms: 0, input_tokens: 0, output_tokens: 0, reason: `Error: ${e.message}` });
  }
}

async function testSmartAbbreviation(target: CompatTestTarget): Promise<CompatTestResult> {
  const testId = 'smart_abbreviation';
  const testName = 'Singkatan Lokal (SKU)';
  try {
    const r = await callChat(target, [{ role: 'user', content: SMART_ABBREVIATION_PROMPT }], { maxTokens: 100 });
    const jsonMatch = r.content.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      return smartResult(testId, testName, { status: 'FAIL', latency_ms: r.latencyMs, input_tokens: r.inputTokens, output_tokens: r.outputTokens, reason: 'Respons bukan JSON', raw_preview: r.content.substring(0, 200) });
    }
    let parsed: any;
    try { parsed = JSON.parse(jsonMatch[0]); } catch {
      return smartResult(testId, testName, { status: 'FAIL', latency_ms: r.latencyMs, input_tokens: r.inputTokens, output_tokens: r.outputTokens, reason: 'JSON tidak valid', raw_preview: r.content.substring(0, 200) });
    }
    const kepanjangan = String(parsed.kepanjangan || '').toLowerCase();
    if (kepanjangan.includes('surat') && kepanjangan.includes('keterangan') && kepanjangan.includes('usaha')) {
      return smartResult(testId, testName, { status: 'PASS', latency_ms: r.latencyMs, input_tokens: r.inputTokens, output_tokens: r.outputTokens, reason: `SKU = "${parsed.kepanjangan}"`, raw_preview: r.content.substring(0, 200) });
    }
    return smartResult(testId, testName, { status: 'FAIL', latency_ms: r.latencyMs, input_tokens: r.inputTokens, output_tokens: r.outputTokens, reason: `Salah: "${parsed.kepanjangan}" (expected Surat Keterangan Usaha)`, raw_preview: r.content.substring(0, 200) });
  } catch (e: any) {
    return smartResult(testId, testName, { status: 'FAIL', latency_ms: 0, input_tokens: 0, output_tokens: 0, reason: `Error: ${e.message}` });
  }
}

async function testSmartIntentMulti(target: CompatTestTarget): Promise<CompatTestResult> {
  const testId = 'smart_intent_multi';
  const testName = 'Klasifikasi Intent (3 kasus)';
  const expected = ['CREATE_COMPLAINT', 'SERVICE_INFO', 'GREETING'];
  try {
    const r = await callChat(target, [{ role: 'user', content: SMART_INTENT_MULTI_PROMPT }], { maxTokens: 200 });
    const jsonMatch = r.content.match(/\[[\s\S]*\]/);
    if (!jsonMatch) {
      return smartResult(testId, testName, { status: 'FAIL', latency_ms: r.latencyMs, input_tokens: r.inputTokens, output_tokens: r.outputTokens, reason: 'Respons bukan JSON array', raw_preview: r.content.substring(0, 200) });
    }
    let parsed: any;
    try { parsed = JSON.parse(jsonMatch[0]); } catch {
      return smartResult(testId, testName, { status: 'FAIL', latency_ms: r.latencyMs, input_tokens: r.inputTokens, output_tokens: r.outputTokens, reason: 'JSON tidak valid', raw_preview: r.content.substring(0, 200) });
    }
    if (!Array.isArray(parsed) || parsed.length < 3) {
      return smartResult(testId, testName, { status: 'FAIL', latency_ms: r.latencyMs, input_tokens: r.inputTokens, output_tokens: r.outputTokens, reason: 'Array tidak lengkap (butuh 3)', raw_preview: r.content.substring(0, 200) });
    }
    let correct = 0;
    const details: string[] = [];
    for (let i = 0; i < 3; i++) {
      const got = String(parsed[i]?.intent || '').toUpperCase().replace(/^COMPLAINT$/, 'CREATE_COMPLAINT');
      const want = expected[i];
      if (got === want) { correct++; details.push(`#${i + 1} ✓`); }
      else { details.push(`#${i + 1} ✗ (got ${parsed[i]?.intent}, want ${want})`); }
    }
    if (correct === 3) {
      return smartResult(testId, testName, { status: 'PASS', latency_ms: r.latencyMs, input_tokens: r.inputTokens, output_tokens: r.outputTokens, reason: 'Semua 3 intent benar', raw_preview: r.content.substring(0, 200) });
    }
    return smartResult(testId, testName, { status: 'FAIL', latency_ms: r.latencyMs, input_tokens: r.inputTokens, output_tokens: r.outputTokens, reason: `${correct}/3 benar: ${details.join(', ')}`, raw_preview: r.content.substring(0, 200) });
  } catch (e: any) {
    return smartResult(testId, testName, { status: 'FAIL', latency_ms: 0, input_tokens: 0, output_tokens: 0, reason: `Error: ${e.message}` });
  }
}

async function testSmartHonestRefusal(target: CompatTestTarget): Promise<CompatTestResult> {
  const testId = 'smart_honest_refusal';
  const testName = 'Penolakan Jujur (SIM)';
  try {
    const r = await callChat(target, [{ role: 'user', content: SMART_REFUSAL_PROMPT }], { maxTokens: 150 });
    const lower = r.content.toLowerCase();
    const garbled = detectGarbled(r.content);
    if (garbled.garbled) {
      return smartResult(testId, testName, { status: 'FAIL', latency_ms: r.latencyMs, input_tokens: r.inputTokens, output_tokens: r.outputTokens, reason: garbled.reason, raw_preview: r.content.substring(0, 200) });
    }
    // Harus bilang tidak bisa / bukan layanan desa
    const honestSignals = ['tidak bisa', 'tidak dapat', 'bukan', 'polri', 'samsat', 'satpas'];
    const hasHonest = honestSignals.some((s) => lower.includes(s));
    // Tidak boleh mengarang prosedur
    const fabricateSignals = ['syaratnya adalah', 'langkah pertama', 'bawa ktp ke desa untuk sim', 'formulir sim'];
    const fabricates = fabricateSignals.some((s) => lower.includes(s));
    if (hasHonest && !fabricates) {
      return smartResult(testId, testName, { status: 'PASS', latency_ms: r.latencyMs, input_tokens: r.inputTokens, output_tokens: r.outputTokens, reason: 'Menolak dengan jujur, tidak mengarang', raw_preview: r.content.substring(0, 200) });
    }
    if (fabricates) {
      return smartResult(testId, testName, { status: 'FAIL', latency_ms: r.latencyMs, input_tokens: r.inputTokens, output_tokens: r.outputTokens, reason: 'Mengarang prosedur SIM (halusinasi)', raw_preview: r.content.substring(0, 200) });
    }
    return smartResult(testId, testName, { status: 'FAIL', latency_ms: r.latencyMs, input_tokens: r.inputTokens, output_tokens: r.outputTokens, reason: 'Tidak menolak dengan jelas', raw_preview: r.content.substring(0, 200) });
  } catch (e: any) {
    return smartResult(testId, testName, { status: 'FAIL', latency_ms: 0, input_tokens: 0, output_tokens: 0, reason: `Error: ${e.message}` });
  }
}

async function testSmartComplex(target: CompatTestTarget): Promise<CompatTestResult> {
  const testId = 'smart_complex';
  const testName = 'Instruksi Kompleks (multi-entity)';
  try {
    const r = await callChat(target, [{ role: 'user', content: SMART_COMPLEX_PROMPT }], { maxTokens: 150 });
    const jsonMatch = r.content.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      return smartResult(testId, testName, { status: 'FAIL', latency_ms: r.latencyMs, input_tokens: r.inputTokens, output_tokens: r.outputTokens, reason: 'Respons bukan JSON', raw_preview: r.content.substring(0, 200) });
    }
    let parsed: any;
    try { parsed = JSON.parse(jsonMatch[0]); } catch {
      return smartResult(testId, testName, { status: 'FAIL', latency_ms: r.latencyMs, input_tokens: r.inputTokens, output_tokens: r.outputTokens, reason: 'JSON tidak valid', raw_preview: r.content.substring(0, 200) });
    }
    const nama = String(parsed.nama || '').toLowerCase();
    const kategori = String(parsed.kategori || '').toLowerCase();
    const lokasi = String(parsed.lokasi || '').toLowerCase();
    const namaOk = nama === 'andi';
    const kategoriOk = kategori.includes('lampu') || kategori.includes('penerangan');
    const lokasiOk = lokasi.includes('05') || lokasi.includes('rt');
    const score = [namaOk, kategoriOk, lokasiOk].filter(Boolean).length;
    if (score === 3) {
      return smartResult(testId, testName, { status: 'PASS', latency_ms: r.latencyMs, input_tokens: r.inputTokens, output_tokens: r.outputTokens, reason: 'NAMA=Andi, KATEGORI=lampu, LOKASI=RT 05 semua benar', raw_preview: r.content.substring(0, 200) });
    }
    return smartResult(testId, testName, { status: 'FAIL', latency_ms: r.latencyMs, input_tokens: r.inputTokens, output_tokens: r.outputTokens, reason: `${score}/3 benar (nama:${namaOk}, kategori:${kategoriOk}, lokasi:${lokasiOk})`, raw_preview: r.content.substring(0, 200) });
  } catch (e: any) {
    return smartResult(testId, testName, { status: 'FAIL', latency_ms: 0, input_tokens: 0, output_tokens: 0, reason: `Error: ${e.message}` });
  }
}

// ── Main runner ────────────────────────────────────────────────────────

export async function runCompatibilityTest(target: CompatTestTarget): Promise<CompatibilityReport> {
  const results: CompatTestResult[] = [];

  // Basic tests (bobot 1x)
  results.push(await testBasicChat(target));
  results.push(await testJsonStructured(target));
  results.push(await testVision(target));

  // GovConnect smartness tests (bobot 2x)
  results.push(await testNameExtraction(target));
  results.push(await testSmartJavanese(target));
  results.push(await testSmartAbbreviation(target));
  results.push(await testSmartIntentMulti(target));
  results.push(await testSmartHonestRefusal(target));
  results.push(await testSmartComplex(target));

  // Test Latency (agregat)
  const timedTests = results.filter((r) => r.status !== 'SKIP' && r.latency_ms > 0);
  const avgLatency = timedTests.length > 0
    ? Math.round(timedTests.reduce((s, r) => s + r.latency_ms, 0) / timedTests.length)
    : 0;
  const maxLatency = timedTests.length > 0 ? Math.max(...timedTests.map((r) => r.latency_ms)) : 0;
  results.push({
    test_id: 'latency',
    test_name: 'Latency',
    status: avgLatency > 0 && avgLatency <= 30000 ? 'PASS' : 'FAIL',
    latency_ms: avgLatency,
    input_tokens: 0,
    output_tokens: 0,
    reason: avgLatency === 0
      ? 'Tidak ada data latency'
      : `Rata-rata ${avgLatency}ms, maksimal ${maxLatency}ms (batas 30s)`,
    weight: 1,
    is_smartness: false,
  });

  // Test Token usage (informasional, selalu PASS jika ada data)
  const totalIn = results.reduce((s, r) => s + r.input_tokens, 0);
  const totalOut = results.reduce((s, r) => s + r.output_tokens, 0);
  results.push({
    test_id: 'token_usage',
    test_name: 'Token Usage',
    status: totalIn + totalOut > 0 ? 'PASS' : 'FAIL',
    latency_ms: 0,
    input_tokens: totalIn,
    output_tokens: totalOut,
    reason: `Total ${totalIn} input + ${totalOut} output = ${totalIn + totalOut} tokens`,
    weight: 1,
    is_smartness: false,
  });

  const passed = results.filter((r) => r.status === 'PASS').length;
  const failed = results.filter((r) => r.status === 'FAIL').length;
  const skipped = results.filter((r) => r.status === 'SKIP').length;
  const total = results.length;

  // Skor berbobot: basic=1, smartness=2
  const maxScore = results.reduce((s, r) => s + (r.status === 'SKIP' ? 0 : r.weight), 0);
  const earnedScore = results
    .filter((r) => r.status === 'PASS')
    .reduce((s, r) => s + r.weight, 0);

  const smartnessResults = results.filter((r) => r.is_smartness);
  const smartnessFailed = smartnessResults.filter((r) => r.status === 'FAIL').length;
  const smartnessTotal = smartnessResults.length;

  let recommendation: CompatRecommendation;
  if (smartnessFailed > 2) {
    // Aturan keras: gagal >2 smartness tests → otomatis TIDAK KOMPATIBEL
    recommendation = 'TIDAK KOMPATIBEL';
  } else if (failed === 0) {
    recommendation = 'KOMPATIBEL';
  } else if (passed >= Math.ceil((total - skipped) * 0.6)) {
    recommendation = 'SEBAGIAN';
  } else {
    recommendation = 'TIDAK KOMPATIBEL';
  }

  const report: CompatibilityReport = {
    model: target.model_name,
    provider: target.provider_name || 'Manual',
    provider_slug: target.provider_slug || 'manual',
    tested_at: new Date().toISOString(),
    results,
    passed,
    failed,
    skipped,
    total,
    score: `${earnedScore}/${maxScore}`,
    smartness_failed: smartnessFailed,
    smartness_total: smartnessTotal,
    recommendation,
    total_latency_ms: results.reduce((s, r) => s + r.latency_ms, 0),
    total_input_tokens: totalIn,
    total_output_tokens: totalOut,
  };

  logger.info('Model compatibility test completed', {
    model: target.model_name,
    provider: target.provider_slug,
    score: report.score,
    smartness_failed: smartnessFailed,
    recommendation,
  });

  return report;
}

// ── Target resolvers ───────────────────────────────────────────────────

export async function resolveTargetByModelId(modelId: string): Promise<CompatTestTarget> {
  const model = await prisma.ai_models.findUnique({
    where: { id: modelId },
    include: { provider: true },
  });
  if (!model?.provider) throw new Error('Model tidak ditemukan');
  if (!model.provider.is_active) throw new Error('Provider tidak aktif');
  if (!model.provider.api_key_encrypted) throw new Error('API key provider belum di-set');

  return {
    base_url: model.provider.base_url,
    api_key: decryptSecret(model.provider.api_key_encrypted),
    model_name: model.upstream_model_name,
    endpoint_path: model.endpoint_path,
    supports_vision: model.supports_vision === true,
    provider_name: model.provider.name,
    provider_slug: model.provider.slug,
    default_headers_json: model.provider.default_headers_json,
  };
}

export async function resolveTargetByDraft(draft: any): Promise<CompatTestTarget> {
  if (!draft?.provider_id || typeof draft.provider_id !== 'string') {
    throw new Error('provider_id wajib diisi');
  }
  if (!draft?.upstream_model_name || typeof draft.upstream_model_name !== 'string') {
    throw new Error('upstream_model_name wajib diisi');
  }
  const provider = await prisma.ai_providers.findUnique({ where: { id: draft.provider_id } });
  if (!provider) throw new Error('Provider tidak ditemukan');
  if (!provider.is_active) throw new Error('Provider tidak aktif');
  if (!provider.api_key_encrypted) throw new Error('API key provider belum di-set');

  return {
    base_url: provider.base_url,
    api_key: decryptSecret(provider.api_key_encrypted),
    model_name: draft.upstream_model_name.trim(),
    endpoint_path: typeof draft.endpoint_path === 'string' ? draft.endpoint_path : '/chat/completions',
    supports_vision: draft.supports_vision === true,
    provider_name: provider.name,
    provider_slug: provider.slug,
    default_headers_json: provider.default_headers_json,
  };
}

export function resolveTargetManual(manual: any): CompatTestTarget {
  if (!manual?.base_url || typeof manual.base_url !== 'string') {
    throw new Error('base_url wajib diisi');
  }
  if (!manual?.api_key || typeof manual.api_key !== 'string') {
    throw new Error('api_key wajib diisi');
  }
  if (!manual?.model_name || typeof manual.model_name !== 'string') {
    throw new Error('model_name wajib diisi');
  }
  if (!/^https?:\/\//i.test(manual.base_url)) {
    throw new Error('base_url harus diawali http:// atau https://');
  }
  return {
    base_url: manual.base_url.replace(/\/+$/, ''),
    api_key: manual.api_key,
    model_name: manual.model_name.trim(),
    endpoint_path: '/chat/completions',
    supports_vision: manual.supports_vision === true,
    provider_name: 'Manual',
    provider_slug: 'manual',
  };
}
