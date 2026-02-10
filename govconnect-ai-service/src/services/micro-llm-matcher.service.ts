/**
 * Micro LLM Matcher Service
 *
 * Lightweight Gemini calls for semantic matching tasks:
 * - Complaint type resolution (kategori → ComplaintType)
 * - Service slug resolution (query → Service)
 *
 * Uses the cheapest/fastest models (flash-lite) with low token limits.
 * No hardcoded synonyms — AI handles all vocabulary understanding.
 */

import { GoogleGenerativeAI } from '@google/generative-ai';
import { config } from '../config/env';
import logger from '../utils/logger';
import { extractAndRecord } from './token-usage.service';
import type { LayerType, CallType } from './token-usage.service';
import { apiKeyManager, MAX_RETRIES_PER_MODEL, isRateLimitError } from './api-key-manager.service';

// ---------- Model Priority ----------

const DEFAULT_MODELS = [
  'gemini-2.0-flash-lite',
  'gemini-2.5-flash-lite',
  'gemini-2.0-flash',
];

function parseMicroModels(): string[] {
  const raw = (process.env.MICRO_NLU_MODELS || '').trim();
  if (!raw) return DEFAULT_MODELS;
  const models = raw.split(',').map(m => m.trim()).filter(Boolean);
  return models.length > 0 ? models : DEFAULT_MODELS;
}

const MICRO_MODELS = parseMicroModels();

// ---------- Generic micro LLM call (BYOK-aware) ----------

async function callMicroLLM(
  prompt: string,
  call_type: CallType,
  context?: { village_id?: string; wa_user_id?: string; session_id?: string; channel?: string }
): Promise<string | null> {
  if (!config.geminiApiKey && apiKeyManager.getByokKeys().length === 0) {
    logger.warn('Micro LLM skipped: no API keys configured');
    return null;
  }

  // Build call plan using BYOK keys + fallback
  const callPlan = apiKeyManager.getCallPlan(MICRO_MODELS, MICRO_MODELS);

  for (const { key, model: modelName } of callPlan) {
    for (let retry = 0; retry < MAX_RETRIES_PER_MODEL; retry++) {
      try {
        const model = key.genAI.getGenerativeModel({
          model: modelName,
          generationConfig: {
            temperature: 0.1,
            maxOutputTokens: 300,
          },
        });

        const startMs = Date.now();
        const result = await model.generateContent(prompt);
        const durationMs = Date.now() - startMs;

        // Record usage
        if (key.isByok && key.keyId) {
          const usage = result.response.usageMetadata;
          apiKeyManager.recordSuccess(key.keyId);
          apiKeyManager.recordUsage(key.keyId, modelName, usage?.promptTokenCount ?? 0, usage?.totalTokenCount ?? 0);
        }

        extractAndRecord(result, modelName, 'micro_nlu' as LayerType, call_type, {
          ...context,
          success: true,
          duration_ms: durationMs,
          key_source: key.isByok ? 'byok' : 'env',
          key_id: key.keyId,
          key_tier: key.tier,
        });

        return result.response.text();
      } catch (error: any) {
        logger.warn('Micro LLM failed', {
          keyName: key.keyName,
          model: modelName,
          retry: retry + 1,
          error: error.message,
        });

        if (key.isByok && key.keyId) {
          apiKeyManager.recordFailure(key.keyId, error.message);
        }

        // 429 / rate limit → mark model at capacity, skip to next model
        if (isRateLimitError(error.message || '')) {
          if (key.isByok && key.keyId) {
            apiKeyManager.recordRateLimit(key.keyId, modelName, key.tier);
          }
          break;
        }
        // API key error → skip key entirely
        if (error.message?.includes('API_KEY_INVALID') || error.message?.includes('401')) break;
        // Model not found → skip model
        if (error.message?.includes('404') || error.message?.includes('not found')) break;
      }
    }
  }

  logger.error('All micro LLM attempts failed');
  return null;
}

function parseJSON(raw: string): any | null {
  try {
    const cleaned = raw
      .replace(/```json\n?/g, '')
      .replace(/```\n?/g, '')
      .trim();
    return JSON.parse(cleaned);
  } catch {
    return null;
  }
}

// ==================== COMPLAINT TYPE MATCHER ====================

const COMPLAINT_TYPE_PROMPT = `Kamu adalah classifier kategori pengaduan masyarakat Indonesia.

TUGAS:
Diberikan KATA KUNCI pengaduan dari user dan DAFTAR TIPE PENGADUAN yang tersedia.
Tentukan tipe mana yang paling cocok dengan kata kunci user.

ATURAN:
- Pahami MAKNA dan KONTEKS, bukan kecocokan kata literal.
- User bisa pakai bahasa informal, singkatan, typo, bahasa daerah, slang.
- Jika tidak ada yang cocok sama sekali, kembalikan matched_id: null.

OUTPUT (JSON saja, tanpa markdown):
{
  "matched_id": "id_tipe_yang_cocok atau null",
  "confidence": 0.0-1.0,
  "reason": "penjelasan singkat"
}

DAFTAR TIPE PENGADUAN:
{types_list}

KATA KUNCI USER:
{kategori}`;

export interface ComplaintTypeMatch {
  matched_id: string | null;
  confidence: number;
  reason: string;
}

export async function matchComplaintType(
  kategori: string,
  types: Array<{ id: string; name: string; categoryName: string }>,
  context?: { village_id?: string; wa_user_id?: string; session_id?: string; channel?: string }
): Promise<ComplaintTypeMatch | null> {
  if (!kategori || !types.length) return null;

  const typesList = types
    .map(t => `- ID: "${t.id}" | Tipe: "${t.name}" | Kategori: "${t.categoryName}"`)
    .join('\n');

  const prompt = COMPLAINT_TYPE_PROMPT
    .replace('{types_list}', typesList)
    .replace('{kategori}', kategori);

  const raw = await callMicroLLM(prompt, 'complaint_type_match', context);
  if (!raw) return null;

  const parsed = parseJSON(raw) as ComplaintTypeMatch | null;
  if (!parsed || typeof parsed.confidence !== 'number') return null;

  // Validate matched_id exists
  if (parsed.matched_id && !types.some(t => t.id === parsed.matched_id)) {
    logger.warn('Micro LLM returned unknown complaint type ID', {
      matched_id: parsed.matched_id,
      kategori,
    });
    return { matched_id: null, confidence: 0, reason: 'invalid_id' };
  }

  logger.info('Micro LLM matched complaint type', {
    kategori,
    matched_id: parsed.matched_id,
    confidence: parsed.confidence,
    reason: parsed.reason,
  });

  return parsed;
}

// ==================== SERVICE SLUG MATCHER ====================

const SERVICE_MATCH_PROMPT = `Kamu adalah classifier layanan pemerintah Indonesia.

TUGAS:
Diberikan QUERY permintaan layanan dari warga dan DAFTAR LAYANAN yang tersedia.
Tentukan layanan mana yang paling cocok dengan permintaan user.

ATURAN:
- Pahami MAKNA dan KONTEKS, bukan kecocokan kata literal.
- User bisa pakai singkatan (KTP, KK, SKU), bahasa informal, slang.
- Jika tidak ada yang cocok sama sekali, kembalikan matched_slug: null.
- PENTING: Jika ada 2+ layanan yang SAMA-SAMA COCOK (ambigu), kembalikan matched_slug: null dan isi alternatives dengan slug+nama layanan yang cocok. Contoh: query "surat BBM" bisa berarti "rekomendasi BBM" atau "pengantar BBM" — ini ambigu.

OUTPUT (JSON saja, tanpa markdown):
{
  "matched_slug": "slug_layanan atau null",
  "confidence": 0.0-1.0,
  "reason": "penjelasan singkat",
  "alternatives": [{"slug": "slug1", "name": "Nama Layanan 1"}, {"slug": "slug2", "name": "Nama Layanan 2"}]
}

DAFTAR LAYANAN:
{services_list}

QUERY USER:
{query}`;

export interface ServiceMatch {
  matched_slug: string | null;
  confidence: number;
  reason: string;
  alternatives?: Array<{ slug: string; name: string }>;
}

export async function matchServiceSlug(
  query: string,
  services: Array<{ slug: string; name: string; description?: string }>,
  context?: { village_id?: string; wa_user_id?: string; session_id?: string; channel?: string }
): Promise<ServiceMatch | null> {
  if (!query || !services.length) return null;

  const servicesList = services
    .map(s => `- Slug: "${s.slug}" | Nama: "${s.name}"${s.description ? ` | Deskripsi: "${s.description}"` : ''}`)
    .join('\n');

  const prompt = SERVICE_MATCH_PROMPT
    .replace('{services_list}', servicesList)
    .replace('{query}', query);

  const raw = await callMicroLLM(prompt, 'service_slug_match', context);
  if (!raw) return null;

  const parsed = parseJSON(raw) as ServiceMatch | null;
  if (!parsed || typeof parsed.confidence !== 'number') return null;

  // Validate matched_slug exists
  if (parsed.matched_slug && !services.some(s => s.slug === parsed.matched_slug)) {
    logger.warn('Micro LLM returned unknown service slug', {
      matched_slug: parsed.matched_slug,
      query,
    });
    return { matched_slug: null, confidence: 0, reason: 'invalid_slug' };
  }

  logger.info('Micro LLM matched service', {
    query,
    matched_slug: parsed.matched_slug,
    confidence: parsed.confidence,
    reason: parsed.reason,
  });

  return parsed;
}

// ==================== NAME UPDATE CLASSIFIER ====================

const NAME_UPDATE_CLASSIFY_PROMPT = `Kamu adalah classifier percakapan untuk layanan publik Indonesia (GovConnect).

KONTEKS:
User saat ini tercatat dengan nama: "{current_name}"
User menyebutkan nama berbeda dalam pesannya.

TUGAS:
Tentukan apakah user BERMAKSUD mengubah/mengoreksi namanya, atau nama tersebut hanya disebut dalam konteks lain (misalnya menyebut nama orang lain, nama tempat, dll).

UPDATE_NAME — user ingin namanya diperbarui:
- Klarifikasi nama: "nama saya Yoga", "saya Yoga bukan Wonyoung"
- Koreksi nama: "nama saya salah, yang benar Yoga"
- Permintaan ganti: "tolong ubah nama saya jadi Yoga", "ganti nama ke Yoga"
- Menyatakan identitas berbeda: "bukan, saya Yoga"

NO_UPDATE — nama disebut tapi bukan untuk mengubah identitas user:
- Menyebut nama orang lain: "saya mau tanya soal Pak Yoga"
- Nama tempat/instansi: "kantor kelurahan Yoga"
- Konteks pelaporan: "yang bermasalah atas nama Yoga"
- Nama dalam percakapan umum tanpa intent mengubah identitas

OUTPUT (JSON saja, tanpa markdown):
{
  "decision": "UPDATE_NAME|NO_UPDATE",
  "new_name": "nama baru jika UPDATE_NAME, null jika NO_UPDATE",
  "confidence": 0.0-1.0,
  "reason": "penjelasan singkat"
}

PESAN USER:
{user_message}`;

export interface NameUpdateResult {
  decision: 'UPDATE_NAME' | 'NO_UPDATE';
  new_name?: string | null;
  confidence: number;
  reason?: string;
}

export async function classifyNameUpdate(
  message: string,
  currentName: string,
  context?: { village_id?: string; wa_user_id?: string; session_id?: string; channel?: string }
): Promise<NameUpdateResult | null> {
  const prompt = NAME_UPDATE_CLASSIFY_PROMPT
    .replace('{current_name}', currentName || '')
    .replace('{user_message}', message || '');

  const raw = await callMicroLLM(prompt, 'name_update_classify', context);
  if (!raw) return null;

  const parsed = parseJSON(raw) as NameUpdateResult | null;
  if (!parsed?.decision || typeof parsed.confidence !== 'number') return null;

  logger.info('Micro LLM classified name update', {
    message: message.substring(0, 60),
    currentName,
    decision: parsed.decision,
    newName: parsed.new_name,
    confidence: parsed.confidence,
  });

  return {
    decision: parsed.decision,
    new_name: parsed.new_name,
    confidence: Math.max(0, Math.min(1, parsed.confidence)),
    reason: parsed.reason,
  };
}

// ==================== UNIFIED MESSAGE CLASSIFIER ====================
// Replaces 3 separate LLM calls (RAG intent + greeting + farewell) with ONE.
// Also infers knowledge categories for smarter RAG retrieval.

const UNIFIED_CLASSIFY_PROMPT = `Kamu adalah classifier pesan untuk sistem layanan publik Indonesia (GovConnect).

TUGAS:
Analisis pesan user dan tentukan SEMUA aspek berikut dalam SATU jawaban:

1. **message_type**: Jenis pesan utama
   - GREETING: Salam murni tanpa permintaan ("halo", "selamat pagi", "assalamualaikum")
   - FAREWELL: Ingin mengakhiri percakapan ("bye", "udah cukup", "gak ada lagi", "makasih udah cukup")
   - QUESTION: Pertanyaan atau permintaan informasi faktual
   - DATA_INPUT: Menjawab pertanyaan bot / memberikan data ("nama saya Budi", "alamat di Jl. Merdeka", "RT 02 RW 01")
   - COMPLAINT: Laporan/keluhan ("jalan rusak", "lampu mati", "sampah menumpuk")
   - CONFIRMATION: Konfirmasi singkat ("ya", "ok", "baik", "tidak", "batal")
   - SOCIAL: Percakapan sosial ("apa kabar?", "kamu siapa?", "siapa namamu?")

2. **rag_needed**: Apakah perlu cari di knowledge base?
   - true: Pertanyaan tentang prosedur/SOP, syarat, biaya, jadwal, lokasi, pejabat/personil, layanan, dokumen, info desa, program, regulasi
   - false: Salam, konfirmasi, data input, keluhan (handled by complaint flow), percakapan sosial, farewell

3. **categories**: Kategori knowledge yang relevan (array, bisa kosong jika rag_needed=false)
   Pilih dari: "jadwal", "kontak", "prosedur", "layanan", "informasi_umum", "faq", "profil_desa", "pengaduan", "struktur_desa"
   Boleh lebih dari satu jika relevan.

CONTOH:
- "halo" → GREETING, rag_needed: false, categories: []
- "jam buka kantor?" → QUESTION, rag_needed: true, categories: ["jadwal"]
- "siapa kepala desanya?" → QUESTION, rag_needed: true, categories: ["informasi_umum", "struktur_desa"]
- "cara buat KTP gimana?" → QUESTION, rag_needed: true, categories: ["prosedur", "layanan"]
- "udah cukup makasih" → FAREWELL, rag_needed: false, categories: []
- "jalan rusak depan masjid" → COMPLAINT, rag_needed: false, categories: []
- "nama saya Yoga" → DATA_INPUT, rag_needed: false, categories: []
- "ya" → CONFIRMATION, rag_needed: false, categories: []
- "layanan apa aja yang ada?" → QUESTION, rag_needed: true, categories: ["layanan"]
- "alamat kantor desa dimana?" → QUESTION, rag_needed: true, categories: ["kontak", "informasi_umum"]

OUTPUT (JSON saja, tanpa markdown):
{
  "message_type": "GREETING|FAREWELL|QUESTION|DATA_INPUT|COMPLAINT|CONFIRMATION|SOCIAL",
  "rag_needed": true/false,
  "categories": ["kategori1", "kategori2"],
  "confidence": 0.0-1.0,
  "reason": "penjelasan singkat"
}

PESAN USER:
{user_message}`;

export type MessageType = 'GREETING' | 'FAREWELL' | 'QUESTION' | 'DATA_INPUT' | 'COMPLAINT' | 'CONFIRMATION' | 'SOCIAL';

export interface UnifiedClassifyResult {
  message_type: MessageType;
  rag_needed: boolean;
  categories: string[];
  confidence: number;
  reason?: string;
}

export async function classifyMessage(
  message: string,
  context?: { village_id?: string; wa_user_id?: string; session_id?: string; channel?: string }
): Promise<UnifiedClassifyResult | null> {
  const prompt = UNIFIED_CLASSIFY_PROMPT.replace('{user_message}', message || '');

  const raw = await callMicroLLM(prompt, 'unified_classify', context);
  if (!raw) return null;

  const parsed = parseJSON(raw) as UnifiedClassifyResult | null;
  if (!parsed?.message_type || typeof parsed.confidence !== 'number') return null;

  // Validate message_type
  const validTypes: MessageType[] = ['GREETING', 'FAREWELL', 'QUESTION', 'DATA_INPUT', 'COMPLAINT', 'CONFIRMATION', 'SOCIAL'];
  if (!validTypes.includes(parsed.message_type)) return null;

  // Ensure categories is always an array
  if (!Array.isArray(parsed.categories)) parsed.categories = [];

  logger.info('Micro LLM unified classify', {
    message: message.substring(0, 60),
    type: parsed.message_type,
    rag_needed: parsed.rag_needed,
    categories: parsed.categories,
    confidence: parsed.confidence,
  });

  return {
    message_type: parsed.message_type,
    rag_needed: !!parsed.rag_needed,
    categories: parsed.categories,
    confidence: Math.max(0, Math.min(1, parsed.confidence)),
    reason: parsed.reason,
  };
}

// ==================== LEGACY WRAPPERS ====================
// These wrap classifyMessage for backward compatibility.
// They share a SINGLE cached result per call chain via classifyMessageCached().

export interface RAGIntentResult {
  decision: 'RAG_REQUIRED' | 'RAG_SKIP';
  confidence: number;
  reason?: string;
  categories?: string[];
}

export interface FarewellResult {
  decision: 'FAREWELL' | 'CONTINUE';
  confidence: number;
  reason?: string;
}

export interface GreetingResult {
  decision: 'GREETING' | 'HAS_REQUEST';
  confidence: number;
  reason?: string;
}

let _cachedClassifyResult: { message: string; result: UnifiedClassifyResult | null; ts: number } | null = null;

/**
 * Get unified classification result, cached within a 2-second window
 * to avoid duplicate LLM calls when greeting/farewell/RAG check the same message.
 */
async function classifyMessageCached(
  message: string,
  context?: { village_id?: string; wa_user_id?: string; session_id?: string; channel?: string }
): Promise<UnifiedClassifyResult | null> {
  const trimmed = message.trim();
  if (_cachedClassifyResult && _cachedClassifyResult.message === trimmed && Date.now() - _cachedClassifyResult.ts < 2000) {
    return _cachedClassifyResult.result;
  }
  const result = await classifyMessage(trimmed, context);
  _cachedClassifyResult = { message: trimmed, result, ts: Date.now() };
  return result;
}

export async function classifyRAGIntent(
  message: string,
  context?: { village_id?: string; wa_user_id?: string; session_id?: string; channel?: string }
): Promise<RAGIntentResult | null> {
  const unified = await classifyMessageCached(message, context);
  if (!unified) return null;
  return {
    decision: unified.rag_needed ? 'RAG_REQUIRED' : 'RAG_SKIP',
    confidence: unified.confidence,
    reason: unified.reason,
    categories: unified.categories,
  };
}

export async function classifyFarewell(
  message: string,
  context?: { village_id?: string; wa_user_id?: string; session_id?: string; channel?: string }
): Promise<FarewellResult | null> {
  const unified = await classifyMessageCached(message, context);
  if (!unified) return null;
  return {
    decision: unified.message_type === 'FAREWELL' ? 'FAREWELL' : 'CONTINUE',
    confidence: unified.confidence,
    reason: unified.reason,
  };
}

export async function classifyGreeting(
  message: string,
  context?: { village_id?: string; wa_user_id?: string; session_id?: string; channel?: string }
): Promise<GreetingResult | null> {
  const unified = await classifyMessageCached(message, context);
  if (!unified) return null;
  return {
    decision: unified.message_type === 'GREETING' ? 'GREETING' : 'HAS_REQUEST',
    confidence: unified.confidence,
    reason: unified.reason,
  };
}
