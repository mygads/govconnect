/**
 * NLU (Natural Language Understanding) LLM Service - ADAPTIVE VERSION
 * 
 * Multi-Stage Adaptive NLU:
 * - Stage 1: Quick regex check (0 LLM calls, 0 tokens)
 * - Stage 2: Light NLU (minimal context, ~500 tokens) - intent + basic info
 * - Stage 3: Deep NLU (full context, ~2000 tokens) - only if needed
 * 
 * This saves tokens by:
 * 1. Not sending full context for simple queries
 * 2. Only fetching RAG when topic requires it
 * 3. Using conversation history smartly (summarized or recent only)
 */

import logger from '../utils/logger';
import { GoogleGenerativeAI } from '@google/generative-ai';
import { config } from '../config/env';
import { modelStatsService } from './model-stats.service';

// ==================== CONFIG ====================

// Max LLM calls per event to prevent loops/infinite calls
const MAX_LLM_CALLS_PER_EVENT = 10;
const callCounters = new Map<string, { count: number; timestamp: number }>();
const COUNTER_RESET_MS = 60000; // Reset counter after 1 minute
const CLEANUP_INTERVAL_MS = 300000; // Cleanup every 5 minutes

// Adaptive context limits
const LIGHT_HISTORY_LIMIT = 5;    // Last 5 messages for light NLU
const FULL_HISTORY_LIMIT = 15;    // Last 15 messages for deep NLU  
const LIGHT_RAG_LIMIT = 800;      // 800 chars RAG for light
const FULL_RAG_LIMIT = 2000;      // 2000 chars RAG for deep

// ==================== MEMORY CLEANUP ====================
// Periodically clean up old entries to prevent memory leak

let lastCleanup = Date.now();

function cleanupExpiredCounters(): void {
  const now = Date.now();
  if (now - lastCleanup < CLEANUP_INTERVAL_MS) return;
  
  lastCleanup = now;
  let cleaned = 0;
  
  for (const [userId, data] of callCounters.entries()) {
    if (now - data.timestamp > COUNTER_RESET_MS) {
      callCounters.delete(userId);
      cleaned++;
    }
  }
  
  if (cleaned > 0) {
    logger.debug('🧹 Cleaned up expired call counters', { cleaned, remaining: callCounters.size });
  }
}

/**
 * Track LLM call count per user session to prevent infinite loops
 * Works for both full NLU and Micro NLU calls
 */
export function incrementCallCount(userId: string): boolean {
  // Run cleanup opportunistically
  cleanupExpiredCounters();
  
  const now = Date.now();
  const existing = callCounters.get(userId);
  
  // Reset if expired
  if (!existing || now - existing.timestamp > COUNTER_RESET_MS) {
    callCounters.set(userId, { count: 1, timestamp: now });
    return true;
  }
  
  // Check limit
  if (existing.count >= MAX_LLM_CALLS_PER_EVENT) {
    logger.warn('🚫 Max LLM calls reached for user', { userId, count: existing.count });
    return false;
  }
  
  existing.count++;
  return true;
}

/**
 * Get current call count for user
 */
export function getCallCount(userId: string): number {
  const existing = callCounters.get(userId);
  if (!existing) return 0;
  if (Date.now() - existing.timestamp > COUNTER_RESET_MS) return 0;
  return existing.count;
}

/**
 * Reset call counter for user (call after event completes)
 */
export function resetCallCount(userId: string): void {
  callCounters.delete(userId);
}

// ==================== MODEL CONFIGURATION ====================

const DEFAULT_NLU_MODELS = [
  'gemini-2.0-flash-lite',
  'gemini-2.5-flash-lite',
  'gemini-2.0-flash',
];

function parseModelListEnv(envValue: string | undefined, fallback: string[]): string[] {
  const raw = (envValue || '').trim();
  if (!raw) return fallback;

  const models = raw.split(',').map((m) => m.trim()).filter(Boolean);
  const unique: string[] = [];
  for (const model of models) {
    if (!unique.includes(model)) unique.push(model);
  }
  return unique.length > 0 ? unique : fallback;
}

// Models for Full NLU (can be overridden via FULL_NLU_MODELS env var)
const NLU_MODEL_PRIORITY = parseModelListEnv(process.env.FULL_NLU_MODELS, DEFAULT_NLU_MODELS);

/**
 * NLU Input - What we send to the LLM
 */
export interface NLUInput {
  message: string;
  wa_user_id: string;
  village_id?: string;
  rag_context?: string;        // Knowledge base context from RAG search
  conversation_history?: string; // FIFO last 30 messages
  user_profile?: {
    nama_lengkap?: string;
    nik?: string;
    alamat?: string;
    no_hp?: string;
  };
  available_services?: Array<{ name: string; slug: string }>;
  available_contact_categories?: string[]; // e.g., ['Pelayanan', 'Pengaduan', 'Keamanan', 'Kesehatan', 'Pemadam']
  available_complaint_categories?: Array<{ category: string; types: string[] }>; // Kategori & jenis pengaduan dari database
}

/**
 * NLU Output - Structured intent detection
 * System uses this to determine action WITHOUT calling another LLM
 */
export interface NLUOutput {
  // Primary action type - what does the user want to DO?
  intent: 
    | 'GREETING'           // Salam, halo, hi
    | 'THANKS'             // Terima kasih, makasih
    | 'ASK_INFO'           // Bertanya informasi apapun (kontak, alamat, jam, layanan, pengetahuan umum)
    | 'CREATE_COMPLAINT'   // Mau lapor/aduan masalah
    | 'CREATE_SERVICE'     // Mau buat layanan administrasi
    | 'CHECK_STATUS'       // Cek status layanan/aduan
    | 'CANCEL'             // Batalkan layanan/aduan
    | 'HISTORY'            // Lihat riwayat
    | 'CONFIRMATION'       // Ya/tidak/oke response
    | 'CONTINUE_FLOW'      // Melanjutkan flow sebelumnya (misal kasih alamat untuk laporan)
    | 'CLARIFY_NEEDED'     // Pesan tidak jelas, perlu klarifikasi
    | 'UNKNOWN';           // Benar-benar tidak jelas

  confidence: number; // 0.0 - 1.0

  // Unified information request (for ASK_INFO)
  info_request?: {
    topic: string;              // Topik yang ditanyakan (kontak, alamat, jam, layanan, dll)
    keywords: string[];         // Kata kunci pencarian
    answer_found?: boolean;     // Apakah jawaban ditemukan di context?
    suggested_answer?: string;  // Jawaban dari context (jika ada)
    data_source?: 'knowledge_base' | 'database' | 'village_profile' | 'not_found';
  };

  // Service-related (if intent involves services)
  service_request?: {
    service_keyword?: string;   // Kata kunci: 'ktp', 'kk', 'surat domisili'
    service_slug_match?: string; // Matched slug from available_services
    exists_in_database?: boolean; // Apakah layanan ada di database?
  };

  // Complaint-related
  complaint_request?: {
    category_keyword?: string;  // Kata kunci kategori
    category_match?: string;    // Matched category dari database
    description?: string;       // Deskripsi lengkap masalah
    location?: string;          // Lokasi jika disebutkan
    is_emergency?: boolean;     // Apakah darurat?
    exists_in_database?: boolean; // Apakah kategori ada di database?
  };

  // Data extraction (from user message)
  extracted_data?: {
    nama_lengkap?: string;
    nik?: string;
    alamat?: string;
    no_hp?: string;
    tracking_number?: string;   // LAP-xxx atau LAY-xxx
  };

  // Confirmation detection (if intent === 'CONFIRMATION')
  confirmation?: {
    is_positive: boolean;       // true = ya/oke/setuju, false = tidak/batal
  };

  // For CONTINUE_FLOW - what flow is being continued
  flow_context?: {
    previous_intent: string;    // Intent sebelumnya
    missing_data: string[];     // Data yang masih kurang
    provided_data: Record<string, string>; // Data yang baru disediakan
  };

  // For CLARIFY_NEEDED - what needs clarification
  clarification?: {
    question: string;           // Pertanyaan klarifikasi
    options?: string[];         // Opsi yang bisa dipilih user
  };

  // Processing notes
  reasoning: string;            // Brief explanation of the classification
  
  // Adaptive flag - does this need deeper analysis?
  needs_more_context?: boolean; // If true, system will do Stage 2 with full context
}

// ==================== ADAPTIVE PROMPT MODES ====================

type NLUMode = 'light' | 'deep';

/**
 * LIGHT System Prompt - Compact version for quick intent detection
 * ~400 tokens instead of ~1500
 */
const NLU_LIGHT_PROMPT = `Kamu AI asisten desa. Tentukan intent user dengan cepat.

INTENTS:
- GREETING: salam/halo
- THANKS: terima kasih
- ASK_INFO: tanya informasi (kontak, alamat, jam, layanan)
- CREATE_COMPLAINT: lapor masalah/aduan
- CREATE_SERVICE: buat layanan (KTP, KK, surat)
- CHECK_STATUS: cek status (LAP-xxx/LAY-xxx)
- CANCEL: batalkan
- HISTORY: lihat riwayat
- CONFIRMATION: ya/tidak
- CONTINUE_FLOW: lanjutkan proses sebelumnya
- CLARIFY_NEEDED: ambigu, perlu tanya ulang
- UNKNOWN: benar-benar tidak jelas

ATURAN:
1. Baca riwayat chat untuk konteks
2. Jika user kasih data (nama/alamat) setelah pengaduan/layanan → CONTINUE_FLOW
3. Jika ambigu → CLARIFY_NEEDED, bukan UNKNOWN
4. Set needs_more_context=true jika butuh knowledge base/database detail

OUTPUT: JSON dengan intent, confidence, reasoning, needs_more_context`;

/**
 * NLU System Prompt - ADAPTIVE & CONTEXTUAL
 * Designed to understand user intent naturally without rigid rules
 */
const NLU_SYSTEM_PROMPT = `Kamu adalah AI asisten cerdas untuk layanan pemerintah desa/kelurahan.
Tugasmu adalah MEMAHAMI maksud pengguna secara natural dan menentukan respons terbaik.
Berlaku SEPERTI MANUSIA - ramah, cerdas, dan bisa minta klarifikasi jika tidak yakin.

## PRINSIP UTAMA

1. **PAHAMI KONTEKS** - Baca semua informasi (knowledge base, riwayat chat, data tersedia)
2. **JAWAB DARI DATA** - Prioritaskan data dari DATABASE, lalu Knowledge Base, lalu Village Profile
3. **VERIFIKASI DATABASE** - Cek apakah layanan/kategori ada di database sebelum menawarkan
4. **ADAPTIVE & HUMAN-LIKE** - Jika tidak yakin, TANYA klarifikasi. Jangan asumsi.
5. **LANJUTKAN FLOW** - Jika user sedang dalam proses (pengaduan/layanan), lanjutkan jangan restart
6. **KONFIRMASI** - Untuk aksi penting (buat laporan/layanan), konfirmasi dulu sebelum proses

## CARA KERJA

### Jika user BERTANYA (informasi, kontak, alamat, jam, dll):
- PRIORITAS DATA (tinggi ke rendah):
  1. DATABASE (kontak penting, layanan, pengaduan) - paling akurat & updated
  2. Knowledge Base Context - informasi umum/prosedur
  3. Village Profile - alamat, jam operasional
- Jika data REDUNDANT/BERBEDA antara sumber, gunakan dari DATABASE
- Jika KETEMU → jawab langsung via info_request.suggested_answer dengan data_source yang benar
- Jika TIDAK KETEMU → jujur bilang tidak ditemukan, tawarkan bantuan lain

### Jika user mau LAPOR/ADUAN:
- Cek kategori di "Kategori Pengaduan di Database"
- Jika kategori COCOK → gunakan kategori tersebut, set exists_in_database=true
- Jika TIDAK COCOK → gunakan "lainnya", set exists_in_database=false
- Kumpulkan: kategori, deskripsi (MINIMAL 15 karakter), lokasi (jika relevan)
- JANGAN pernah tawarkan link/formulir untuk pengaduan
- Untuk DARURAT (kebakaran, kecelakaan, dll): set is_emergency=true
  → Sistem akan otomatis kirim nomor kontak penting (Damkar, RS, dll)

### Jika user mau BUAT LAYANAN (KTP, KK, surat, dll):
- Cek di "Layanan Tersedia" apakah layanan ada
- Jika ADA → boleh tawarkan pembuatan
- Jika TIDAK ADA → hanya jawab informasi saja, JANGAN tawarkan buat layanan
- service_request.exists_in_database = true/false

### Jika user MELANJUTKAN flow (kasih data tambahan):
- Baca Riwayat Percakapan
- Pahami konteks sebelumnya
- Gunakan intent = CONTINUE_FLOW
- Isi flow_context dengan data yang diberikan

### Jika TIDAK JELAS maksudnya:
- JANGAN langsung jawab UNKNOWN
- Gunakan intent = CLARIFY_NEEDED
- Isi clarification.question dengan pertanyaan klarifikasi yang RAMAH
- Berikan opsi jika memungkinkan (misal: "Apakah Kakak mau tanya info atau mau buat laporan?")
- Contoh pertanyaan bagus:
  - "Maaf Kak, bisa diperjelas maksudnya? Apakah tentang layanan atau pengaduan?"
  - "Kakak mau tanya informasi apa ya? Saya bisa bantu info layanan, kontak, atau jam operasional."

### INGAT: Bersikap seperti CS yang CERDAS & RAMAH
- Jangan kaku, jangan formal berlebihan
- Gunakan "Kak" atau "Kakak" 
- Jika tidak yakin = TANYA, jangan asumsi
- Jika data tidak ada = JUJUR bilang tidak ditemukan

## DATA YANG TERSEDIA
- Knowledge Base Context: Informasi desa, profil, FAQ, prosedur
- Village Profile: Alamat, jam operasional, info desa
- Kategori Kontak: Daftar kategori kontak penting
- Layanan Tersedia: Daftar layanan administrasi yang bisa diproses
- Kategori Pengaduan: Daftar kategori untuk laporan/aduan
- Riwayat Percakapan: 30 pesan terakhir untuk konteks

## CONTOH PEMAHAMAN

"ada nomor puskesmas?" → ASK_INFO, cari di kontak/knowledge base
"mau buat KTP" → Cek dulu di Layanan Tersedia, jika ada → CREATE_SERVICE
"jalan rusak di depan rumah" → CREATE_COMPLAINT
"ini alamat saya: Jl Merdeka" → CONTINUE_FLOW (lanjutkan pengaduan/layanan sebelumnya)
"apa aja layanan di sini?" → ASK_INFO, cari di knowledge base + list layanan
"cepat butuh damkar segera!" → ASK_INFO (minta kontak), is_emergency = true

## LARANGAN
- JANGAN mengarang informasi yang tidak ada di context
- JANGAN tawarkan layanan yang tidak ada di database
- JANGAN kirim link/formulir untuk pengaduan (sistem yang handle)
- JANGAN asumsi maksud user jika ambigu - TANYA klarifikasi
- JANGAN langsung intent=UNKNOWN, coba CLARIFY_NEEDED dulu
- JANGAN gunakan bahasa terlalu formal/robot

## CONTOH KEPUTUSAN CERDAS

| User bilang | Keputusan |
|-------------|----------|
| "api" | CLARIFY_NEEDED - "Kak, maksudnya api kebakaran atau mau tanya tentang api?" |
| "rumah saya" | Cek riwayat - mungkin CONTINUE_FLOW dari pengaduan sebelumnya |
| "nomor damkar" | ASK_INFO topic=kontak, is_emergency mungkin true |
| "mau buat ktp" | Cek Layanan Tersedia dulu, jika tidak ada → ASK_INFO saja |
| "jalan rusak depan SD" | CREATE_COMPLAINT, cari kategori infrastruktur/lainnya |`;

/**
 * Build the prompt for NLU - ADAPTIVE VERSION
 * Mode 'light': Minimal context for quick intent detection (~500 tokens)
 * Mode 'deep': Full context for complex queries (~2000 tokens)
 */
function buildNLUPrompt(input: NLUInput, mode: NLUMode = 'deep'): string {
  const parts: string[] = [];

  // User message first - always included
  parts.push(`## Pesan Pengguna\n"${input.message}"`);

  // Conversation history - limited based on mode
  if (input.conversation_history) {
    const historyLimit = mode === 'light' ? LIGHT_HISTORY_LIMIT : FULL_HISTORY_LIMIT;
    const historyLines = input.conversation_history.split('\n');
    const recentHistory = historyLines.slice(-historyLimit * 2).join('\n'); // Each turn = 2 lines
    
    if (recentHistory.length > 0) {
      const charLimit = mode === 'light' ? 600 : 2000;
      parts.push(`\n## Riwayat Percakapan (${historyLimit} terakhir)\n${recentHistory.slice(0, charLimit)}`);
    }
  }

  // For LIGHT mode - only include essential data lists (no RAG)
  if (mode === 'light') {
    // Compact list of available categories for quick matching
    if (input.available_contact_categories?.length) {
      parts.push(`\n## Kontak: ${input.available_contact_categories.slice(0, 10).join(', ')}`);
    }
    if (input.available_services?.length) {
      parts.push(`\n## Layanan: ${input.available_services.slice(0, 10).map(s => s.slug).join(', ')}`);
    }
    if (input.available_complaint_categories?.length) {
      parts.push(`\n## Kategori Pengaduan: ${input.available_complaint_categories.slice(0, 8).map(c => c.category).join(', ')}`);
    }
    return parts.join('\n');
  }

  // DEEP mode - full context
  // Knowledge base context
  if (input.rag_context) {
    parts.push(`\n## Knowledge Base Context\n${input.rag_context.slice(0, FULL_RAG_LIMIT)}`);
  }

  // Available data for verification
  if (input.available_contact_categories?.length) {
    parts.push(`\n## Kategori Kontak Tersedia\n${input.available_contact_categories.join(', ')}`);
  }

  if (input.available_services?.length) {
    const serviceList = input.available_services
      .slice(0, 25)
      .map(s => `- ${s.name} (${s.slug})`)
      .join('\n');
    parts.push(`\n## Layanan Tersedia di Database\n${serviceList}\n\n⚠️ Hanya tawarkan layanan yang ada di daftar ini!`);
  } else {
    parts.push(`\n## Layanan Tersedia\nTidak ada layanan yang dikonfigurasi. Jangan tawarkan pembuatan layanan.`);
  }

  if (input.available_complaint_categories?.length) {
    const categoryList = input.available_complaint_categories
      .map(c => {
        const types = c.types.length > 0 ? `: ${c.types.join(', ')}` : '';
        return `- ${c.category}${types}`;
      })
      .join('\n');
    parts.push(`\n## Kategori Pengaduan di Database\n${categoryList}\n\n⚠️ Jika tidak cocok, gunakan "lainnya"`);
  } else {
    parts.push(`\n## Kategori Pengaduan\nBelum dikonfigurasi. Semua pengaduan masuk ke "lainnya".`);
  }

  if (input.user_profile && Object.keys(input.user_profile).length > 0) {
    const profileStr = Object.entries(input.user_profile)
      .filter(([_, v]) => v)
      .map(([k, v]) => `- ${k}: ${v}`)
      .join('\n');
    if (profileStr) {
      parts.push(`\n## Data User yang Sudah Diketahui\n${profileStr}`);
    }
  }

  return parts.join('\n\n');
}

/**
 * JSON Schema description for NLU output - SIMPLIFIED & ADAPTIVE
 */
const NLU_OUTPUT_FORMAT = `
## OUTPUT JSON FORMAT

{
  "intent": "GREETING|THANKS|ASK_INFO|CREATE_COMPLAINT|CREATE_SERVICE|CHECK_STATUS|CANCEL|HISTORY|CONFIRMATION|CONTINUE_FLOW|CLARIFY_NEEDED|UNKNOWN",
  "confidence": 0.0-1.0,
  
  // Untuk ASK_INFO (semua pertanyaan informasi)
  "info_request": {
    "topic": "kontak|alamat|jam|layanan|pengetahuan_umum|profil_desa",
    "keywords": ["kata", "kunci", "pencarian"],
    "answer_found": true/false,
    "suggested_answer": "Jawaban lengkap dari context jika ditemukan",
    "data_source": "knowledge_base|database|village_profile|not_found"
  },
  
  // Untuk CREATE_SERVICE
  "service_request": {
    "service_keyword": "kata kunci layanan",
    "service_slug_match": "slug dari daftar layanan jika cocok",
    "exists_in_database": true/false  // PENTING: cek di daftar Layanan Tersedia!
  },
  
  // Untuk CREATE_COMPLAINT
  "complaint_request": {
    "category_keyword": "kata kunci kategori",
    "category_match": "kategori dari daftar atau 'lainnya'",
    "description": "deskripsi lengkap masalah (minimal 15 karakter)",
    "location": "lokasi jika disebutkan",
    "is_emergency": true/false,
    "exists_in_database": true/false  // false = gunakan "lainnya"
  },
  
  // Data yang diekstrak dari pesan user
  "extracted_data": {
    "nama_lengkap": "nama jika disebutkan",
    "nik": "NIK jika disebutkan",
    "alamat": "alamat jika disebutkan",
    "no_hp": "nomor HP jika disebutkan",
    "tracking_number": "LAP-xxx atau LAY-xxx jika disebutkan"
  },
  
  // Untuk CONFIRMATION
  "confirmation": { "is_positive": true/false },
  
  // Untuk CONTINUE_FLOW
  "flow_context": {
    "previous_intent": "intent sebelumnya dari riwayat",
    "missing_data": ["data", "yang", "kurang"],
    "provided_data": { "field": "value" }
  },
  
  // Untuk CLARIFY_NEEDED
  "clarification": {
    "question": "Pertanyaan klarifikasi ke user",
    "options": ["opsi1", "opsi2"]
  },
  
  "reasoning": "Penjelasan singkat mengapa memilih intent ini"
}

## PANDUAN PENGISIAN

### ASK_INFO - Untuk SEMUA pertanyaan informasi:
- PRIORITAS SUMBER DATA (tinggi ke rendah):
  1. DATABASE: Kategori Kontak, Layanan Tersedia (paling akurat)
  2. Knowledge Base Context (informasi umum/prosedur)
  3. Village Profile (alamat, jam operasional)
- Jika data REDUNDANT antara sumber, gunakan dari DATABASE
- Jika ketemu → answer_found=true, isi suggested_answer dengan sumber yang tepat
- Jika tidak ketemu → answer_found=false, data_source="not_found"
- Untuk KONTAK: pastikan isi topic="kontak" dan keywords berisi kategori

### CREATE_SERVICE - Hanya jika layanan ADA di database:
- Cek di "Layanan Tersedia di Database"
- Jika ADA → exists_in_database=true, boleh proses
- Jika TIDAK ADA → JANGAN intent ini, gunakan ASK_INFO saja

### CREATE_COMPLAINT - Selalu cek kategori:
- Cek di "Kategori Pengaduan di Database"
- Jika kategori cocok → exists_in_database=true
- Jika tidak cocok → exists_in_database=false, category_match="lainnya"
- WAJIB isi description minimal 15 karakter!
- Untuk DARURAT (kebakaran, kecelakaan): is_emergency=true

### CONTINUE_FLOW - Jika melanjutkan proses:
- Baca Riwayat Percakapan
- Identifikasi proses yang sedang berjalan
- Isi provided_data dengan data baru dari user

### CLARIFY_NEEDED - Jika ambigu:
- Jangan asumsi, jangan langsung UNKNOWN
- Buat pertanyaan klarifikasi yang RAMAH
- Berikan opsi jika memungkinkan
- Contoh: "Maaf Kak, apakah maksudnya X atau Y?"
`;

// Model priority for NLU - FAST models first

/**
 * Determine if we should use light or deep NLU based on message complexity
 */
function shouldUseLightNLU(message: string, hasHistory: boolean): boolean {
  const normalizedMsg = message.toLowerCase().trim();
  const wordCount = normalizedMsg.split(/\s+/).length;
  
  // Light NLU for short messages (< 10 words) without complex queries
  if (wordCount < 10) {
    // Patterns that need deep NLU even if short
    const needsDeep = /bagaimana|gimana|cara|syarat|prosedur|apa\s+(itu|saja)|berapa|biaya/i;
    if (!needsDeep.test(normalizedMsg)) {
      return true;
    }
  }
  
  // Simple intents that can use light NLU
  const simplePatterns = [
    /^(halo|hai|hi|salam|selamat)/i,
    /^(makasih|terima\s*kasih|thanks)/i,
    /^(ya|iya|oke|ok|tidak|ga|gak|batal)/i,
    /nomor\s*(hp|telepon|wa|whatsapp|damkar|puskesmas|polisi)/i,
    /alamat\s*(kantor|desa|kelurahan)/i,
    /jam\s*(buka|operasional|kerja)/i,
    /(cek|status)\s*(lap|lay)/i,
    /riwayat|histori/i,
  ];
  
  for (const pattern of simplePatterns) {
    if (pattern.test(normalizedMsg)) {
      return true;
    }
  }
  
  // If user is continuing a flow (giving data), use light
  if (hasHistory) {
    // Patterns suggesting data input
    const dataPatterns = /^(nama\s*(saya)?|alamat\s*(saya)?|nik\s*(saya)?|no\s*(hp|telp)?\s*(saya)?|jl\.?|jalan)/i;
    if (dataPatterns.test(normalizedMsg)) {
      return true;
    }
  }
  
  return false;
}

/**
 * Light NLU output format - simplified JSON
 */
const NLU_LIGHT_OUTPUT = `
OUTPUT JSON:
{
  "intent": "GREETING|THANKS|ASK_INFO|CREATE_COMPLAINT|CREATE_SERVICE|CHECK_STATUS|CANCEL|HISTORY|CONFIRMATION|CONTINUE_FLOW|CLARIFY_NEEDED|UNKNOWN",
  "confidence": 0.0-1.0,
  "needs_more_context": true/false,  // Set true jika butuh RAG/detail database
  "extracted_data": { "nama_lengkap": "", "alamat": "", "tracking_number": "" },
  "info_request": { "topic": "kontak|alamat|jam|layanan", "keywords": [] },
  "complaint_request": { "category_keyword": "", "is_emergency": false },
  "service_request": { "service_keyword": "" },
  "flow_context": { "previous_intent": "", "provided_data": {} },
  "clarification": { "question": "", "options": [] },
  "reasoning": "Penjelasan singkat"
}`;

/**
 * Call NLU LLM with adaptive mode
 * @param input NLU input data
 * @param mode 'light' for quick detection, 'deep' for full analysis
 */
export async function callNLU(input: NLUInput, mode?: NLUMode): Promise<NLUOutput | null> {
  const startTime = Date.now();
  
  // Determine mode if not specified
  const actualMode = mode || (shouldUseLightNLU(input.message, !!input.conversation_history) ? 'light' : 'deep');
  
  const isLightMode = actualMode === 'light';

  logger.info('🧠 NLU LLM call started', {
    wa_user_id: input.wa_user_id,
    mode: actualMode,
    messageLength: input.message.length,
    hasRagContext: !!input.rag_context,
    hasHistory: !!input.conversation_history,
    availableCategories: input.available_contact_categories?.length || 0,
    availableServices: input.available_services?.length || 0,
  });

  const userPrompt = buildNLUPrompt(input, actualMode);
  const systemPrompt = isLightMode 
    ? NLU_LIGHT_PROMPT + '\n\n' + NLU_LIGHT_OUTPUT 
    : NLU_SYSTEM_PROMPT + '\n\n' + NLU_OUTPUT_FORMAT;
  
  const maxTokens = isLightMode ? 500 : 1500;

  for (let i = 0; i < NLU_MODEL_PRIORITY.length; i++) {
    const model = NLU_MODEL_PRIORITY[i];

    try {
      logger.info('🔄 NLU attempting model', {
        wa_user_id: input.wa_user_id,
        model,
        mode: actualMode,
        attempt: i + 1,
      });

      const genAI = new GoogleGenerativeAI(config.geminiApiKey);
      const geminiModel = genAI.getGenerativeModel({
        model,
        generationConfig: {
          temperature: 0.1, // Low for consistent classification
          maxOutputTokens: maxTokens,
          responseMimeType: 'application/json',
        },
        systemInstruction: systemPrompt,
      });

      const result = await geminiModel.generateContent(userPrompt);
      const responseText = result.response.text();

      // Parse response
      let parsed: NLUOutput;
      try {
        parsed = JSON.parse(responseText);
      } catch {
        // Try to extract JSON from response
        const jsonMatch = responseText.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
          parsed = JSON.parse(jsonMatch[0]);
        } else {
          throw new Error('Invalid JSON response');
        }
      }

      // Validate required fields
      if (!parsed.intent || typeof parsed.confidence !== 'number') {
        throw new Error('Missing required fields');
      }

      const durationMs = Date.now() - startTime;
      modelStatsService.recordSuccess(model, durationMs);

      logger.info('✅ NLU LLM success', {
        wa_user_id: input.wa_user_id,
        model,
        mode: actualMode,
        intent: parsed.intent,
        confidence: parsed.confidence,
        needsMoreContext: parsed.needs_more_context,
        hasInfoRequest: !!parsed.info_request,
        hasServiceRequest: !!parsed.service_request,
        hasComplaintRequest: !!parsed.complaint_request,
        durationMs,
        promptLength: userPrompt.length,
      });

      return parsed;

    } catch (error: any) {
      const durationMs = Date.now() - startTime;
      modelStatsService.recordFailure(model, error.message, durationMs);

      logger.warn('❌ NLU model failed', {
        wa_user_id: input.wa_user_id,
        model,
        attempt: i + 1,
        error: error.message,
      });

      if (i === NLU_MODEL_PRIORITY.length - 1) {
        logger.error('🚨 All NLU models failed', {
          wa_user_id: input.wa_user_id,
        });
        return null;
      }
    }
  }

  return null;
}

/**
 * Adaptive NLU with automatic retry in deep mode if needed
 * This is the main entry point for NLU - handles multi-stage automatically
 */
export async function callNLUAdaptive(input: NLUInput): Promise<NLUOutput | null> {
  // Stage 1: Try light NLU first
  const lightResult = await callNLU(input, 'light');
  
  if (!lightResult) {
    return null;
  }
  
  // Check if we need deeper analysis
  if (lightResult.needs_more_context && lightResult.confidence < 0.8) {
    logger.info('🔄 NLU needs deeper analysis, switching to deep mode', {
      wa_user_id: input.wa_user_id,
      lightIntent: lightResult.intent,
      lightConfidence: lightResult.confidence,
    });
    
    // Stage 2: Deep NLU with full context
    const deepResult = await callNLU(input, 'deep');
    if (deepResult) {
      return deepResult;
    }
    
    // Fallback to light result if deep fails
    return lightResult;
  }
  
  // Light result is sufficient
  return lightResult;
}

/**
 * DEPRECATED: quickIntentCheck removed - all intent detection now via Micro NLU
 * 
 * Micro NLU provides LLM-based intent classification that:
 * - Understands natural language variations
 * - Uses conversation context
 * - Handles ambiguity gracefully
 * 
 * See: micro-nlu.service.ts
 */
