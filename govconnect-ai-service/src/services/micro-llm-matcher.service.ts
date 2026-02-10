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

// ==================== NAME EXTRACTION (NLU) ====================
// Replaces keyword-based extractNameFromText with semantic NLU understanding.

const NAME_EXTRACTION_PROMPT = `Kamu adalah extractor nama untuk layanan publik Indonesia (GovConnect).

TUGAS:
Dari pesan user, tentukan apakah user menyebutkan NAMANYA SENDIRI. Jika ya, ekstrak nama tersebut.

ATURAN:
- Hanya ekstrak nama ORANG (bukan nama tempat/instansi/layanan).
- Nama valid: minimal 2 karakter, huruf alfabet.
- Hapus prefix "Pak/Bu/Bapak/Ibu" dari hasil.
- Jika user menjawab pertanyaan "siapa nama Anda?", anggap jawaban sebagai nama.
- "saya X" → X biasanya nama JIKA X bukan kata umum.
- Salam ("halo", "assalamualaikum"), kata tanya, kata umum → bukan nama.
- Harus jawaban singkat, bukan deskripsi panjang.

OUTPUT (JSON saja):
{
  "name": "nama atau null",
  "confidence": 0.0-1.0,
  "is_name_statement": true/false
}

CONTOH:
- "nama saya Yoga" → {"name":"Yoga","confidence":0.95,"is_name_statement":true}
- "Budi Santoso" → {"name":"Budi Santoso","confidence":0.85,"is_name_statement":true}
- "saya warga desa" → {"name":null,"confidence":0.9,"is_name_statement":false}
- "halo" → {"name":null,"confidence":0.95,"is_name_statement":false}
- "ya" → {"name":null,"confidence":0.95,"is_name_statement":false}

KONTEKS ASISTEN TERAKHIR:
{assistant_context}

PESAN USER:
{user_message}`;

export interface NameExtractionResult {
  name: string | null;
  confidence: number;
  is_name_statement: boolean;
}

export async function extractNameViaNLU(
  message: string,
  context?: { village_id?: string; wa_user_id?: string; session_id?: string; channel?: string; last_assistant_message?: string }
): Promise<NameExtractionResult | null> {
  const assistantCtx = context?.last_assistant_message
    ? `Asisten terakhir bertanya: "${context.last_assistant_message.substring(0, 150)}"`
    : 'Tidak ada konteks sebelumnya.';

  const prompt = NAME_EXTRACTION_PROMPT
    .replace('{assistant_context}', assistantCtx)
    .replace('{user_message}', message || '');

  const raw = await callMicroLLM(prompt, 'name_extraction', context);
  if (!raw) return null;

  const parsed = parseJSON(raw) as NameExtractionResult | null;
  if (!parsed || typeof parsed.confidence !== 'number') return null;

  // Normalize name: capitalize first letter
  if (parsed.name) {
    parsed.name = parsed.name.trim();
    if (parsed.name.length < 2) parsed.name = null;
    else {
      parsed.name = parsed.name
        .split(/\s+/)
        .slice(0, 3) // max 3 words
        .map(w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
        .join(' ');
    }
  }

  logger.info('Micro LLM extracted name', {
    message: message.substring(0, 60),
    name: parsed.name,
    confidence: parsed.confidence,
    is_name_statement: parsed.is_name_statement,
  });

  return parsed;
}

// ==================== KNOWLEDGE QUERY SUBTYPE CLASSIFIER ====================
// Replaces regex-based isAskingAddress, isAskingHours, isAskingContact, etc.

const KNOWLEDGE_SUBTYPE_PROMPT = `Kamu adalah router pertanyaan untuk layanan publik Indonesia (GovConnect).

TUGAS:
Tentukan jenis spesifik pertanyaan user untuk menentukan apakah jawaban harus dari DATA FAKTUAL (DB) atau dari knowledge base (RAG).

JENIS PERTANYAAN:
- address: Bertanya alamat/lokasi kantor/google maps
- hours: Bertanya jam operasional/buka/tutup/hari kerja
- contact: Bertanya nomor telepon/kontak/hotline/WA instansi
- tracking: Menyebutkan nomor laporan/layanan (LAP-xxx, LAY-xxx) atau tanya status
- photo_request: Ingin kirim/upload foto atau gambar
- service_info: Bertanya tentang layanan/surat/persyaratan/prosedur
- complaint_update: Ingin update/tambah informasi laporan yang sudah ada
- general: Pertanyaan umum lainnya

OUTPUT (JSON saja):
{
  "subtype": "address|hours|contact|tracking|photo_request|service_info|complaint_update|general",
  "confidence": 0.0-1.0,
  "contact_entity": "nama instansi/organisasi jika subtype=contact, null jika bukan"
}

CONTOH:
- "dimana alamat kantor desa?" → {"subtype":"address","confidence":0.95,"contact_entity":null}
- "jam berapa buka?" → {"subtype":"hours","confidence":0.95,"contact_entity":null}
- "nomor telepon puskesmas?" → {"subtype":"contact","confidence":0.95,"contact_entity":"puskesmas"}
- "LAP-20250115-001" → {"subtype":"tracking","confidence":0.95,"contact_entity":null}
- "mau kirim foto" → {"subtype":"photo_request","confidence":0.90,"contact_entity":null}
- "nomor polisi?" → {"subtype":"contact","confidence":0.90,"contact_entity":"polisi"}
- "berapa biaya buat KTP?" → {"subtype":"service_info","confidence":0.85,"contact_entity":null}

PESAN USER:
{user_message}`;

export type KnowledgeSubtype = 'address' | 'hours' | 'contact' | 'tracking' | 'photo_request' | 'service_info' | 'complaint_update' | 'general';

export interface KnowledgeSubtypeResult {
  subtype: KnowledgeSubtype;
  confidence: number;
  contact_entity: string | null;
}

export async function classifyKnowledgeSubtype(
  message: string,
  context?: { village_id?: string; wa_user_id?: string; session_id?: string; channel?: string }
): Promise<KnowledgeSubtypeResult | null> {
  const prompt = KNOWLEDGE_SUBTYPE_PROMPT
    .replace('{user_message}', message || '');

  const raw = await callMicroLLM(prompt, 'knowledge_subtype', context);
  if (!raw) return null;

  const parsed = parseJSON(raw) as KnowledgeSubtypeResult | null;
  if (!parsed?.subtype || typeof parsed.confidence !== 'number') return null;

  const validSubtypes: KnowledgeSubtype[] = ['address', 'hours', 'contact', 'tracking', 'photo_request', 'service_info', 'complaint_update', 'general'];
  if (!validSubtypes.includes(parsed.subtype)) parsed.subtype = 'general';

  logger.info('Micro LLM classified knowledge subtype', {
    message: message.substring(0, 60),
    subtype: parsed.subtype,
    confidence: parsed.confidence,
    contact_entity: parsed.contact_entity,
  });

  return parsed;
}

// ==================== ADDRESS ANALYSIS (NLU) ====================
// Replaces isVagueAddress, extractAddressFromMessage, extractAddressFromComplaintMessage.
// Combined extraction + quality assessment in ONE call.

const ADDRESS_ANALYSIS_PROMPT = `Kamu adalah analis alamat untuk layanan publik Indonesia (GovConnect).

TUGAS:
Dari pesan user, tentukan apakah ada ALAMAT atau LOKASI. Jika ada, ekstrak dan nilai kualitasnya.

ATURAN:
- Alamat SPESIFIK: ada nama jalan + nomor, atau RT/RW, atau nama tempat spesifik (Masjid Al-Ikhlas, SMAN 1 Bandung, dll)
- Alamat VAGUE: terlalu umum ("di jalan raya", "di sini", "di desa")  
- Kata pengaduan (rusak, mati, banjir, sampah, dll) → BUKAN bagian alamat, pisahkan
- Landmark (masjid, sekolah, pasar, kantor, dll) = alamat VALID jika cukup spesifik
- "di depan SMAN 1" = valid, "di jalan" = vague

OUTPUT (JSON saja):
{
  "has_address": true/false,
  "address": "alamat yang diekstrak atau null",
  "quality": "specific|vague|not_address",
  "confidence": 0.0-1.0
}

CONTOH:
- "lampu mati di depan SMAN 1 Margahayu" → {"has_address":true,"address":"depan SMAN 1 Margahayu","quality":"specific","confidence":0.9}
- "jalan rusak di jalan sudirman no 10" → {"has_address":true,"address":"Jalan Sudirman No 10","quality":"specific","confidence":0.95}
- "sampah menumpuk di sini" → {"has_address":true,"address":"di sini","quality":"vague","confidence":0.8}
- "jalan berlubang" → {"has_address":false,"address":null,"quality":"not_address","confidence":0.9}
- "Jl Melati RT 03 RW 05" → {"has_address":true,"address":"Jl Melati RT 03 RW 05","quality":"specific","confidence":0.95}
- "ya" → {"has_address":false,"address":null,"quality":"not_address","confidence":0.95}

KONTEKS:
{context_info}

PESAN USER:
{user_message}`;

export type AddressQuality = 'specific' | 'vague' | 'not_address';

export interface AddressAnalysisResult {
  has_address: boolean;
  address: string | null;
  quality: AddressQuality;
  confidence: number;
}

export async function analyzeAddress(
  message: string,
  context?: { village_id?: string; wa_user_id?: string; session_id?: string; channel?: string; kategori?: string; is_complaint_context?: boolean }
): Promise<AddressAnalysisResult | null> {
  const contextInfo = context?.is_complaint_context
    ? `User sedang membuat laporan pengaduan${context.kategori ? ` kategori: ${context.kategori}` : ''}.`
    : 'User bisa saja memberikan alamat atau pesan biasa.';

  const prompt = ADDRESS_ANALYSIS_PROMPT
    .replace('{context_info}', contextInfo)
    .replace('{user_message}', message || '');

  const raw = await callMicroLLM(prompt, 'address_analysis', context);
  if (!raw) return null;

  const parsed = parseJSON(raw) as AddressAnalysisResult | null;
  if (!parsed || typeof parsed.confidence !== 'number') return null;

  const validQualities: AddressQuality[] = ['specific', 'vague', 'not_address'];
  if (!validQualities.includes(parsed.quality)) parsed.quality = 'not_address';

  // Ensure consistency
  if (!parsed.has_address) {
    parsed.address = null;
    parsed.quality = 'not_address';
  }

  logger.info('Micro LLM analyzed address', {
    message: message.substring(0, 60),
    has_address: parsed.has_address,
    address: parsed.address,
    quality: parsed.quality,
    confidence: parsed.confidence,
  });

  return parsed;
}

// ==================== CONTACT QUERY MATCHER (NLU) ====================
// Replaces keywordTargets and queryStopWords with semantic contact matching.

const CONTACT_MATCH_PROMPT = `Kamu adalah pencocokan kontak untuk layanan publik Indonesia.

TUGAS:
Diberikan pertanyaan user tentang kontak/nomor telepon dan DAFTAR KONTAK yang tersedia,
tentukan kontak mana yang paling relevan dengan permintaan user.

ATURAN:
- Pahami MAKNA permintaan, bukan kecocokan kata literal.
- User bisa pakai singkatan (damkar=pemadam, RS=rumah sakit, dll).
- Kembalikan INDEX kontak yang cocok (0-based).
- Jika tidak ada yang cocok, kembalikan array kosong.

OUTPUT (JSON saja):
{
  "matched_indices": [0, 2],
  "confidence": 0.0-1.0,
  "query_description": "penjelasan singkat apa yang user cari"
}

DAFTAR KONTAK:
{contacts_list}

PERTANYAAN USER:
{user_query}`;

export interface ContactMatchResult {
  matched_indices: number[];
  confidence: number;
  query_description?: string;
}

export async function matchContactQuery(
  query: string,
  contacts: Array<{ name: string; description?: string; category?: string }>,
  context?: { village_id?: string; wa_user_id?: string; session_id?: string; channel?: string }
): Promise<ContactMatchResult | null> {
  if (!query || !contacts.length) return null;

  const contactsList = contacts
    .map((c, i) => `[${i}] Nama: "${c.name}"${c.description ? ` | Deskripsi: "${c.description}"` : ''}${c.category ? ` | Kategori: "${c.category}"` : ''}`)
    .join('\n');

  const prompt = CONTACT_MATCH_PROMPT
    .replace('{contacts_list}', contactsList)
    .replace('{user_query}', query);

  const raw = await callMicroLLM(prompt, 'contact_match', context);
  if (!raw) return null;

  const parsed = parseJSON(raw) as ContactMatchResult | null;
  if (!parsed || !Array.isArray(parsed.matched_indices)) return null;

  // Validate indices
  parsed.matched_indices = parsed.matched_indices.filter(i => typeof i === 'number' && i >= 0 && i < contacts.length);

  logger.info('Micro LLM matched contacts', {
    query: query.substring(0, 60),
    matched_count: parsed.matched_indices.length,
    confidence: parsed.confidence,
  });

  return parsed;
}

// ==================== UPDATE INTENT CLASSIFIER (NLU) ====================
// Replaces wantsPhoto regex and other update intent detection.

const UPDATE_INTENT_PROMPT = `Kamu adalah classifier intent update untuk layanan publik Indonesia.

TUGAS:
Tentukan apa yang ingin user lakukan terkait laporan/layanan yang sudah ada.

JENIS INTENT:
- send_photo: User ingin mengirim/upload foto atau gambar pendukung
- update_info: User ingin menambah/mengubah informasi (alamat, deskripsi, dll)
- check_status: User ingin cek status terbaru
- cancel: User ingin membatalkan
- other: Lainnya

OUTPUT (JSON saja):
{
  "intent": "send_photo|update_info|check_status|cancel|other",
  "confidence": 0.0-1.0
}

PESAN USER:
{user_message}`;

export type UpdateIntent = 'send_photo' | 'update_info' | 'check_status' | 'cancel' | 'other';

export interface UpdateIntentResult {
  intent: UpdateIntent;
  confidence: number;
}

export async function classifyUpdateIntent(
  message: string,
  context?: { village_id?: string; wa_user_id?: string; session_id?: string; channel?: string }
): Promise<UpdateIntentResult | null> {
  const prompt = UPDATE_INTENT_PROMPT
    .replace('{user_message}', message || '');

  const raw = await callMicroLLM(prompt, 'update_intent', context);
  if (!raw) return null;

  const parsed = parseJSON(raw) as UpdateIntentResult | null;
  if (!parsed?.intent || typeof parsed.confidence !== 'number') return null;

  const validIntents: UpdateIntent[] = ['send_photo', 'update_info', 'check_status', 'cancel', 'other'];
  if (!validIntents.includes(parsed.intent)) parsed.intent = 'other';

  logger.info('Micro LLM classified update intent', {
    message: message.substring(0, 60),
    intent: parsed.intent,
    confidence: parsed.confidence,
  });

  return parsed;
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

// ── Conversation Summarization via Micro LLM ──

const SUMMARIZE_PROMPT = `Ringkas percakapan berikut menjadi 2-4 kalimat singkat dalam Bahasa Indonesia.
Fokus pada: nama user, topik utama, data yang sudah diberikan (alamat, nomor laporan/layanan, kategori keluhan), dan status terakhir percakapan.
Jangan menambahkan informasi yang tidak ada di percakapan.

PERCAKAPAN:
{conversation}

Output hanya ringkasan singkat, tanpa format JSON.`;

// Cache summarization results per userId to avoid re-summarizing unchanged history
// Uses TTL-based eviction with bounded size to prevent unbounded memory growth.
const _summaryCache = new Map<string, { hash: string; summary: string; ts: number }>();
const SUMMARY_CACHE_TTL = 10 * 60 * 1000; // 10 minutes (increased from 5m — summaries are stable)
const MAX_SUMMARY_CACHE = 200;

function simpleHash(text: string): string {
  let hash = 0;
  for (let i = 0; i < text.length; i++) {
    hash = ((hash << 5) - hash + text.charCodeAt(i)) | 0;
  }
  return hash.toString(36);
}

/**
 * Summarize older conversation history via micro LLM to save tokens.
 * Only called when history exceeds threshold (e.g., >8 messages).
 * Returns a 2-4 sentence summary of the older messages.
 */
export async function summarizeConversation(
  messages: Array<{ role: string; content: string }>,
  context?: { village_id?: string; wa_user_id?: string; session_id?: string; channel?: string }
): Promise<string | null> {
  if (!messages || messages.length === 0) return null;

  const userId = context?.wa_user_id || 'unknown';
  const conversationText = messages.map(m => `${m.role}: ${m.content}`).join('\n');
  const hash = simpleHash(conversationText);

  // Check cache
  const cached = _summaryCache.get(userId);
  if (cached && cached.hash === hash && Date.now() - cached.ts < SUMMARY_CACHE_TTL) {
    return cached.summary;
  }

  const prompt = SUMMARIZE_PROMPT.replace('{conversation}', conversationText);
  const result = await callMicroLLM(prompt, 'summarize' as CallType, context);

  if (result) {
    const summary = result.trim();
    const now = Date.now();
    _summaryCache.set(userId, { hash, summary, ts: now });

    // Evict expired + enforce max size
    if (_summaryCache.size > MAX_SUMMARY_CACHE) {
      for (const [key, val] of _summaryCache) {
        if (now - val.ts > SUMMARY_CACHE_TTL) _summaryCache.delete(key);
      }
      // If still over limit, remove oldest entries
      while (_summaryCache.size > MAX_SUMMARY_CACHE) {
        const firstKey = _summaryCache.keys().next().value;
        if (firstKey) _summaryCache.delete(firstKey); else break;
      }
    }

    return summary;
  }

  return null;
}

// ── Anti-Hallucination Validation via Micro LLM ──

const VALIDATE_HALLUCINATION_PROMPT = `Kamu adalah validator fakta. Periksa apakah respons AI di bawah mengandung informasi yang TIDAK ADA di KNOWLEDGE yang diberikan.

KNOWLEDGE (sumber kebenaran):
{knowledge}

RESPONS AI:
{response}

Periksa apakah respons menyebut:
1. Jam operasional/jadwal yang TIDAK ada di knowledge
2. Nomor telepon/kontak yang TIDAK ada di knowledge
3. Alamat spesifik yang TIDAK ada di knowledge
4. Biaya/tarif yang TIDAK ada di knowledge
5. Link/URL palsu atau placeholder

Output HANYA JSON:
{"has_hallucination": true/false, "issues": ["deskripsi masalah 1", ...]}`;

export interface HallucinationValidation {
  has_hallucination: boolean;
  issues: string[];
}

/**
 * Validate LLM response against knowledge context using micro LLM.
 * Much cheaper than doing a full LLM retry (~10x less tokens).
 * Returns validation result indicating if hallucination was detected.
 */
export async function validateResponseAgainstKnowledge(
  response: string,
  knowledge: string,
  context?: { village_id?: string; wa_user_id?: string; session_id?: string; channel?: string }
): Promise<HallucinationValidation | null> {
  if (!response || !knowledge) return null;

  // Truncate to save tokens — we only need enough context
  const truncatedKnowledge = knowledge.length > 1500 ? knowledge.substring(0, 1500) + '...' : knowledge;
  const truncatedResponse = response.length > 500 ? response.substring(0, 500) + '...' : response;

  const prompt = VALIDATE_HALLUCINATION_PROMPT
    .replace('{knowledge}', truncatedKnowledge)
    .replace('{response}', truncatedResponse);

  const result = await callMicroLLM(prompt, 'hallucination_check' as CallType, context);
  if (!result) return null;

  try {
    const parsed = parseJSON(result) as HallucinationValidation | null;
    return parsed;
  } catch {
    return null;
  }
}

// Keyed cache for classify results — prevents race conditions under concurrent requests.
// Key = hash(message), stores result per-message with 2s TTL.
const _classifyCache = new Map<string, { result: UnifiedClassifyResult | null; ts: number }>();
const CLASSIFY_CACHE_TTL = 2000; // 2 seconds
const MAX_CLASSIFY_CACHE = 50;

/**
 * Get unified classification result, cached within a 2-second window
 * to avoid duplicate LLM calls when greeting/farewell/RAG check the same message.
 * Uses keyed Map instead of single global variable to handle concurrent requests safely.
 */
async function classifyMessageCached(
  message: string,
  context?: { village_id?: string; wa_user_id?: string; session_id?: string; channel?: string }
): Promise<UnifiedClassifyResult | null> {
  const trimmed = message.trim();
  const cacheKey = simpleHash(trimmed);
  const now = Date.now();

  const cached = _classifyCache.get(cacheKey);
  if (cached && now - cached.ts < CLASSIFY_CACHE_TTL) {
    return cached.result;
  }

  const result = await classifyMessage(trimmed, context);
  _classifyCache.set(cacheKey, { result, ts: now });

  // Evict expired entries when cache grows too large
  if (_classifyCache.size > MAX_CLASSIFY_CACHE) {
    for (const [k, v] of _classifyCache) {
      if (now - v.ts > CLASSIFY_CACHE_TTL) _classifyCache.delete(k);
    }
    // If still too large after TTL eviction, remove oldest
    if (_classifyCache.size > MAX_CLASSIFY_CACHE) {
      const firstKey = _classifyCache.keys().next().value;
      if (firstKey) _classifyCache.delete(firstKey);
    }
  }

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
