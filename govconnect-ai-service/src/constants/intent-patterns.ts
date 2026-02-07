/**
 * Intent Patterns Constants
 * 
 * SINGLE SOURCE OF TRUTH untuk semua intent patterns.
 * 
 * PURPOSE: These patterns are ONLY used as:
 * 1. FALLBACK when LLM completely fails (fallback-response.service.ts)
 * 2. Safety net for intent detection when no LLM response available
 * 
 * The main AI flow uses Gemini LLM for all intent classification.
 * These patterns do NOT bypass LLM — they are the last resort.
 */

// ==================== INTENT TYPES ====================

export type IntentType = 
  | 'GREETING'
  | 'THANKS'
  | 'CONFIRMATION'
  | 'REJECTION'
  | 'CREATE_COMPLAINT'
  | 'UPDATE_COMPLAINT'
  | 'SERVICE_INFO'
  | 'CREATE_SERVICE_REQUEST'
  | 'UPDATE_SERVICE_REQUEST'
  | 'CHECK_STATUS'
  | 'CANCEL_COMPLAINT'
  | 'CANCEL_SERVICE_REQUEST'
  | 'HISTORY'
  | 'KNOWLEDGE_QUERY'
  | 'QUESTION'
  | 'UNKNOWN';

// ==================== GREETING PATTERNS ====================

export const GREETING_PATTERNS = [
  /^(halo|hai|hi|hello|hey)[\s!.,]*$/i,
  /^selamat\s+(pagi|siang|sore|malam)[\s!.,]*$/i,
  /^(assalamualaikum|assalamu'?alaikum)[\s!.,]*$/i,
  /^(permisi|maaf\s+ganggu)[\s!.,]*$/i,
  /^(p|pagi|siang|sore|malam)[\s!.,]*$/i,
];

// ==================== CONFIRMATION PATTERNS ====================

export const CONFIRMATION_PATTERNS = [
  /^(ya|iya|yap|yup|yoi|oke|ok|okay|okey|baik|siap|betul|benar|bener)[\s!.,]*$/i,
  /^(lanjut|lanjutkan|proses|setuju|boleh|bisa|gas|gaskan)[\s!.,]*$/i,
  /^(sudah|udah|cukup|itu\s+saja|itu\s+aja|segitu\s+aja)[\s!.,]*$/i,
];

// ==================== REJECTION PATTERNS ====================

export const REJECTION_PATTERNS = [
  /^(tidak|nggak|gak|ga|enggak|engga|no|nope|jangan|batal|cancel)[\s!.,]*$/i,
  /^(belum|nanti\s+dulu|nanti\s+aja|skip)[\s!.,]*$/i,
];

// ==================== THANKS PATTERNS ====================

export const THANKS_PATTERNS = [
  /^(terima\s*kasih|makasih|thanks|thank\s*you|thx|tq)[\s!.,]*$/i,
  /^(ok\s+)?makasih[\s!.,]*$/i,
  /^(mantap|keren|bagus|good)[\s!.,]*$/i,
];

// ==================== COMPLAINT PATTERNS ====================

export const CREATE_COMPLAINT_PATTERNS = [
  // Direct complaint keywords
  /\b(mau\s+)?lapor(kan)?\s+/i,
  /\b(ada\s+)?(masalah|keluhan|aduan|komplain)\s+(di|dengan|tentang)/i,
  
  // Specific complaint types
  /\b(jalan|aspal)\s+(rusak|berlubang|retak|hancur|jelek)\b/i,
  /\b(lampu|penerangan)\s+(jalan\s+)?(mati|padam|rusak|tidak\s+menyala)\b/i,
  /\b(sampah)\s+(menumpuk|berserakan|banyak|tidak\s+diangkut)\b/i,
  /\b(saluran|got|selokan|drainase)\s+(tersumbat|mampet|macet|buntu)\b/i,
  /\b(pohon)\s+(tumbang|roboh|patah|miring)\b/i,
  /\b(ada\s+)?banjir\s+(di|besar|parah)/i,
  /\b(mau\s+lapor\s+)?banjir\b/i,
  /\b(fasilitas|taman|pagar)\s+(rusak|jelek)\b/i,
];

// ==================== SERVICE REQUEST PATTERNS ====================

export const SERVICE_INFO_PATTERNS = [
  /\b(syarat|persyaratan|prosedur|biaya|tarif)\b/i,
  /\b(apa\s+saja)\s+(syarat|dokumen|berkas)\b/i,
  /\b(cara|proses)\s+(buat|bikin|urus|daftar)\b/i,
];

export const CREATE_SERVICE_REQUEST_PATTERNS = [
  /\b(mau|ingin)\s+(buat|bikin|urus|ajukan)\s+(layanan|surat|dokumen)\b/i,
  /\b(daftar|ajukan)\s+(layanan|surat|dokumen)\b/i,
  /\b(perlu|butuh)\s+(surat|dokumen)\b/i,
];

export const UPDATE_SERVICE_REQUEST_PATTERNS = [
  /\b(ubah|edit|perbarui|update)\s+(layanan|permohonan|pengajuan|surat)\b/i,
  /\b(ubah|edit)\s+(data|berkas|form)\s+(layanan|permohonan)\b/i,
];

// ==================== UPDATE COMPLAINT PATTERNS ====================

export const UPDATE_COMPLAINT_PATTERNS = [
  /\b(ubah|ganti|perbarui|update)\s+(laporan|pengaduan|keluhan)\b/i,
  /\b(ubah|ganti)\s+(alamat|deskripsi|keterangan)\s+laporan\b/i,
];

// ==================== STATUS CHECK PATTERNS ====================

export const CHECK_STATUS_PATTERNS = [
  /\b(cek|check|lihat|gimana|bagaimana)\s+(status|perkembangan|progress)\b/i,
  /\b(status)\s+(laporan|layanan|permohonan|pengaduan)\b/i,
  /\bLAP-\d{8}-\d{3}\b/i,
  /\bLAY-\d{8}-\d{3}\b/i,
  /\b(sudah|udah)\s+(sampai\s+mana|diproses|ditangani)\b/i,
];

// ==================== CANCEL PATTERNS ====================

export const CANCEL_PATTERNS = [
  /\b(batalkan|cancel|batal)\s+(laporan|pengaduan)\b/i,
  /\b(mau|ingin)\s+(batalkan|cancel|batal)\b/i,
  /\b(hapus)\s+(laporan|pengaduan)\b/i,
];

export const CANCEL_SERVICE_PATTERNS = [
  /\b(batalkan|cancel|batal)\s+(layanan|permohonan|surat|pengajuan)\b/i,
  /\b(hapus)\s+(layanan|permohonan|surat)\b/i,
];

// ==================== HISTORY PATTERNS ====================

export const HISTORY_PATTERNS = [
  /\b(riwayat|history|daftar)\s+(laporan|layanan|permohonan|saya)\b/i,
  /\b(laporan|layanan)\s+(saya|ku|gue|gw)\b/i,
  /\b(lihat|cek)\s+(semua\s+)?(laporan|layanan)\b/i,
];

// ==================== KNOWLEDGE QUERY PATTERNS ====================

export const KNOWLEDGE_QUERY_PATTERNS = [
  // Time/schedule questions
  /\b(jam|waktu)\s+(buka|tutup|operasional|kerja|pelayanan)\b/i,
  /\b(buka|tutup)\s+(jam\s+)?berapa\b/i,
  /\b(hari\s+)?(libur|kerja)\b/i,
  /\bkapan\s+(buka|tutup)\b/i,
  
  // Location questions
  /\b(dimana|di\s+mana|lokasi|alamat)\s+(kantor|kelurahan)\b/i,
  /\b(kantor|kelurahan)\s+(dimana|di\s+mana)\b/i,
  
  // Requirement questions
  /\b(apa\s+)?(syarat|persyaratan|dokumen|berkas)\b/i,
  /\b(biaya|tarif|harga|bayar)\s+(berapa|nya)\b/i,
  /\b(gratis|free|tidak\s+bayar)\b/i,
  /\bperlu\s+bawa\s+apa\b/i,
  
  // Process questions
  /\b(bagaimana|gimana)\s+(cara|proses|prosedur)\b/i,
  /\b(cara|proses|prosedur|langkah)\s+(buat|bikin|urus|daftar)\b/i,
  /\b(berapa\s+lama|durasi|waktu\s+proses)\b/i,
  
  // Service list questions
  /\blayanan\s*(apa\s*saja|yang\s*tersedia)\b/i,
  /\bapa\s*saja\s*(layanan|surat)\b/i,
  /\bjenis\s*(layanan|surat)\b/i,
  /\bbisa\s*(urus|buat)\s*apa\b/i,
];

// ==================== HELPER FUNCTIONS ====================

/**
 * Check if message matches any pattern in array
 */
export function matchesAnyPattern(message: string, patterns: RegExp[]): boolean {
  return patterns.some(pattern => pattern.test(message));
}

/**
 * Find matching category from patterns
 */
export function findMatchingCategory(
  message: string, 
  categoryPatterns: Record<string, RegExp[]>
): string | null {
  for (const [category, patterns] of Object.entries(categoryPatterns)) {
    if (matchesAnyPattern(message, patterns)) {
      return category;
    }
  }
  return null;
}

/**
 * Detect intent from message using patterns
 */
export function detectIntentFromPatterns(message: string): IntentType | null {
  const lowerMessage = message.toLowerCase().trim();
  
  // Short message checks first
  if (lowerMessage.length < 30) {
    if (matchesAnyPattern(lowerMessage, GREETING_PATTERNS)) return 'GREETING';
  }
  
  if (lowerMessage.length < 20) {
    if (matchesAnyPattern(lowerMessage, CONFIRMATION_PATTERNS)) return 'CONFIRMATION';
    if (matchesAnyPattern(lowerMessage, REJECTION_PATTERNS)) return 'REJECTION';
    if (matchesAnyPattern(lowerMessage, THANKS_PATTERNS)) return 'THANKS';
  }
  
  // Check for IDs first (high confidence)
  if (/\bLAP-\d{8}-\d{3}\b/i.test(message) || /\bLAY-\d{8}-\d{3}\b/i.test(message)) {
    return 'CHECK_STATUS';
  }
  
  // Other intents
  if (matchesAnyPattern(lowerMessage, CHECK_STATUS_PATTERNS)) return 'CHECK_STATUS';
  if (matchesAnyPattern(lowerMessage, UPDATE_COMPLAINT_PATTERNS)) return 'UPDATE_COMPLAINT';
  if (matchesAnyPattern(lowerMessage, CANCEL_SERVICE_PATTERNS)) return 'CANCEL_SERVICE_REQUEST';
  if (matchesAnyPattern(lowerMessage, CANCEL_PATTERNS)) return 'CANCEL_COMPLAINT';
  if (matchesAnyPattern(lowerMessage, HISTORY_PATTERNS)) return 'HISTORY';
  if (matchesAnyPattern(lowerMessage, CREATE_COMPLAINT_PATTERNS)) return 'CREATE_COMPLAINT';
  if (matchesAnyPattern(lowerMessage, SERVICE_INFO_PATTERNS)) return 'SERVICE_INFO';
  if (matchesAnyPattern(lowerMessage, CREATE_SERVICE_REQUEST_PATTERNS)) return 'CREATE_SERVICE_REQUEST';
  if (matchesAnyPattern(lowerMessage, KNOWLEDGE_QUERY_PATTERNS)) return 'KNOWLEDGE_QUERY';
  
  return null;
}

export default {
  GREETING_PATTERNS,
  CONFIRMATION_PATTERNS,
  REJECTION_PATTERNS,
  THANKS_PATTERNS,
  CREATE_COMPLAINT_PATTERNS,
  SERVICE_INFO_PATTERNS,
  CREATE_SERVICE_REQUEST_PATTERNS,
  UPDATE_COMPLAINT_PATTERNS,
  CHECK_STATUS_PATTERNS,
  CANCEL_PATTERNS,
  CANCEL_SERVICE_PATTERNS,
  HISTORY_PATTERNS,
  KNOWLEDGE_QUERY_PATTERNS,
  matchesAnyPattern,
  findMatchingCategory,
  detectIntentFromPatterns,
};
