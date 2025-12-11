/**
 * Fallback Response Service
 * 
 * Smart fallback responses ketika LLM gagal atau tidak tersedia.
 * Menggunakan template-based responses dengan variasi untuk menghindari
 * response yang monoton.
 * 
 * Features:
 * - Intent-based fallback templates
 * - Random variation untuk response yang lebih natural
 * - Context-aware fallback (berdasarkan collected data)
 * - Graceful degradation
 */

import logger from '../utils/logger';
import { getContext, ConversationState } from './conversation-fsm.service';

// ==================== FALLBACK TEMPLATES ====================

/**
 * Fallback templates per intent
 * Multiple variations untuk menghindari response yang monoton
 */
const FALLBACK_TEMPLATES: Record<string, string[]> = {
  // === GREETING ===
  'GREETING': [
    'Halo Kak! 👋 Saya Gana dari Kelurahan. Ada yang bisa dibantu hari ini?',
    'Hai Kak! 👋 Selamat datang di GovConnect. Saya siap membantu untuk laporan atau reservasi surat.',
    'Halo! 👋 Saya asisten virtual kelurahan. Mau lapor masalah atau urus surat hari ini?',
  ],

  // === CREATE COMPLAINT ===
  'CREATE_COMPLAINT': [
    'Baik Kak, saya bantu catat laporan. Boleh sebutkan lokasinya di mana?',
    'Saya catat ya Kak. Masalahnya di lokasi mana tepatnya?',
    'Oke Kak, saya bantu proses laporan. Bisa sebutkan alamat lengkapnya?',
  ],

  // === CREATE RESERVATION ===
  'CREATE_RESERVATION': [
    'Baik Kak, untuk reservasi saya perlu beberapa data. Siapa nama lengkap Kakak sesuai KTP?',
    'Oke Kak, saya bantu buatkan reservasi. Boleh sebutkan nama lengkap Kakak?',
    'Baik, untuk pengajuan surat saya perlu data Kakak. Nama lengkap sesuai KTP siapa ya?',
  ],

  // === CHECK STATUS ===
  'CHECK_STATUS': [
    'Untuk cek status, boleh sebutkan nomor laporan atau reservasinya Kak? (contoh: LAP-20251201-001)',
    'Baik Kak, mau cek status yang mana? Sebutkan nomornya ya (LAP-xxx atau RSV-xxx)',
    'Oke, saya bantu cek. Nomor laporan atau reservasinya berapa Kak?',
  ],

  // === CANCEL ===
  'CANCEL_COMPLAINT': [
    'Untuk membatalkan laporan, boleh sebutkan nomornya Kak? (contoh: LAP-20251201-001)',
    'Baik Kak, mau batalkan laporan yang mana? Sebutkan nomornya ya.',
  ],
  'CANCEL_RESERVATION': [
    'Untuk membatalkan reservasi, boleh sebutkan nomornya Kak? (contoh: RSV-20251201-001)',
    'Baik Kak, mau batalkan reservasi yang mana? Sebutkan nomornya ya.',
  ],

  // === HISTORY ===
  'HISTORY': [
    'Mohon tunggu sebentar ya Kak, saya cek riwayat laporan dan reservasi Kakak...',
    'Baik Kak, saya lihat dulu riwayatnya ya...',
  ],

  // === KNOWLEDGE QUERY ===
  'KNOWLEDGE_QUERY': [
    'Untuk informasi tersebut, Kakak bisa:\n\n📞 Hubungi: (022) 123-4567\n🕐 Jam kerja: Senin-Jumat 08:00-15:00\n📍 Datang langsung ke kantor kelurahan',
    'Maaf Kak, saya belum punya info lengkap tentang itu. Silakan hubungi kantor kelurahan langsung ya di jam kerja.',
  ],

  // === THANKS ===
  'THANKS': [
    'Sama-sama Kak! 😊 Senang bisa membantu. Kalau ada yang perlu lagi, langsung chat aja ya!',
    'Terima kasih kembali Kak! 🙏 Jangan ragu hubungi lagi kalau butuh bantuan.',
  ],

  // === CONFIRMATION ===
  'CONFIRMATION': [
    'Baik Kak, saya proses ya. Mohon tunggu sebentar...',
    'Oke Kak, sedang saya proses...',
  ],

  // === REJECTION ===
  'REJECTION': [
    'Baik Kak, tidak masalah. Ada yang lain yang bisa saya bantu?',
    'Oke Kak, dibatalkan ya. Mau dibantu yang lain?',
  ],

  // === UNKNOWN / DEFAULT ===
  'UNKNOWN': [
    'Maaf Kak, bisa dijelaskan lebih detail? Saya siap bantu untuk:\n\n📋 Lapor masalah (jalan rusak, lampu mati, dll)\n🎫 Reservasi surat (SKD, SKTM, dll)\n📍 Info kelurahan',
    'Hmm, saya kurang paham Kak. Kakak mau:\n\n1️⃣ Lapor masalah?\n2️⃣ Urus surat?\n3️⃣ Cek status?\n\nSilakan pilih atau jelaskan lebih detail ya.',
    'Maaf Kak, coba jelaskan lagi ya. Saya bisa bantu:\n\n• Laporan keluhan/aduan\n• Reservasi layanan surat\n• Informasi kelurahan',
  ],

  // === ERROR ===
  'ERROR': [
    'Mohon maaf Kak, ada kendala teknis 🙏 Coba ulangi pesan Kakak ya.',
    'Maaf Kak, sistem sedang sibuk. Silakan coba lagi dalam beberapa saat.',
    'Waduh, ada gangguan teknis nih Kak. Coba kirim ulang pesannya ya 🙏',
  ],
};

// ==================== STATE-BASED FALLBACKS ====================

/**
 * Fallback berdasarkan conversation state
 * Lebih context-aware daripada intent-based
 */
const STATE_FALLBACKS: Record<ConversationState, string[]> = {
  'IDLE': FALLBACK_TEMPLATES['UNKNOWN'],
  
  'COLLECTING_COMPLAINT_DATA': [
    'Untuk melanjutkan laporan, saya perlu info lokasi masalahnya Kak. Di mana alamatnya?',
    'Baik Kak, boleh sebutkan alamat lengkap lokasi masalahnya?',
  ],
  
  'CONFIRMING_COMPLAINT': [
    'Apakah data laporan sudah benar Kak? Ketik "ya" untuk lanjut atau "tidak" untuk ubah.',
    'Mau saya proses laporannya Kak? Ketik "ya" atau "lanjut" untuk konfirmasi.',
  ],
  
  'COLLECTING_RESERVATION_DATA': [
    'Untuk reservasi, saya masih perlu beberapa data Kak. Boleh dilengkapi?',
    'Data reservasi belum lengkap Kak. Ada yang perlu ditambahkan?',
  ],
  
  'CONFIRMING_RESERVATION': [
    'Apakah data reservasi sudah benar Kak? Ketik "ya" untuk konfirmasi.',
    'Mau saya buatkan reservasinya Kak? Ketik "ya" untuk lanjut.',
  ],
  
  'AWAITING_ADDRESS_DETAIL': [
    'Alamatnya kurang spesifik Kak. Bisa tambahkan detail seperti RT/RW atau patokan terdekat?',
    'Boleh sebutkan alamat lebih lengkap Kak? Misalnya nama jalan, nomor, atau patokan.',
  ],
  
  'AWAITING_CONFIRMATION': [
    'Menunggu konfirmasi Kakak. Ketik "ya" untuk lanjut atau "tidak" untuk batal.',
    'Silakan konfirmasi Kak. Ketik "ya" atau "tidak".',
  ],
  
  'CHECK_STATUS_FLOW': [
    'Untuk cek status, sebutkan nomor laporan atau reservasinya ya Kak.',
    'Nomor laporan/reservasinya berapa Kak? (contoh: LAP-20251201-001)',
  ],
  
  'CANCELLATION_FLOW': [
    'Untuk pembatalan, sebutkan nomor yang mau dibatalkan ya Kak.',
    'Nomor laporan/reservasi yang mau dibatalkan berapa Kak?',
  ],
};

// ==================== MISSING FIELD PROMPTS ====================

/**
 * Prompt untuk field yang belum diisi
 */
const MISSING_FIELD_PROMPTS: Record<string, string[]> = {
  // Complaint fields
  'kategori': [
    'Jenis masalah apa yang ingin dilaporkan Kak? (jalan rusak, lampu mati, sampah, dll)',
    'Masalahnya tentang apa Kak? Jalan rusak, lampu mati, atau yang lain?',
  ],
  'alamat': [
    'Di mana lokasi masalahnya Kak? Sebutkan alamat atau patokan terdekat.',
    'Lokasinya di mana Kak? Bisa sebutkan alamat lengkapnya?',
  ],
  'deskripsi': [
    'Bisa jelaskan lebih detail masalahnya Kak?',
    'Kondisinya seperti apa Kak? Ceritakan lebih detail.',
  ],
  
  // Reservation fields
  'service_code': [
    'Surat apa yang ingin Kakak urus? (SKD, SKTM, SKU, dll)',
    'Mau buat surat apa Kak? Domisili, tidak mampu, atau yang lain?',
  ],
  'nama_lengkap': [
    'Siapa nama lengkap Kakak sesuai KTP?',
    'Boleh sebutkan nama lengkap Kakak?',
  ],
  'nik': [
    'Berapa NIK (16 digit) Kakak?',
    'Boleh sebutkan NIK Kakak? (16 digit angka)',
  ],
  'no_hp': [
    'Nomor HP yang bisa dihubungi berapa Kak?',
    'Boleh sebutkan nomor HP Kakak?',
  ],
  'reservation_date': [
    'Kakak mau datang tanggal berapa?',
    'Mau reservasi untuk tanggal berapa Kak?',
  ],
  'reservation_time': [
    'Jam berapa Kakak mau datang? (08:00-15:00)',
    'Mau datang jam berapa Kak?',
  ],
};

// ==================== MAIN FUNCTIONS ====================

/**
 * Get random item from array
 */
function getRandomItem<T>(items: T[]): T {
  return items[Math.floor(Math.random() * items.length)];
}

/**
 * Get fallback response based on intent
 * 
 * @param intent - Detected or expected intent
 * @returns Random fallback response for the intent
 */
export function getFallbackByIntent(intent: string): string {
  const templates = FALLBACK_TEMPLATES[intent] || FALLBACK_TEMPLATES['UNKNOWN'];
  return getRandomItem(templates);
}

/**
 * Get fallback response based on conversation state
 * More context-aware than intent-based
 * 
 * @param userId - User ID to get conversation context
 * @returns Context-aware fallback response
 */
export function getFallbackByState(userId: string): string {
  const ctx = getContext(userId);
  const templates = STATE_FALLBACKS[ctx.state] || FALLBACK_TEMPLATES['UNKNOWN'];
  return getRandomItem(templates);
}

/**
 * Get prompt for missing field
 * 
 * @param field - Field name that is missing
 * @returns Prompt asking for the field
 */
export function getMissingFieldPrompt(field: string): string {
  const prompts = MISSING_FIELD_PROMPTS[field];
  if (prompts) {
    return getRandomItem(prompts);
  }
  return `Boleh sebutkan ${field.replace(/_/g, ' ')} Kakak?`;
}

/**
 * Get smart fallback response
 * Combines intent, state, and missing fields for best response
 * 
 * @param userId - User ID
 * @param intent - Detected intent (optional)
 * @param message - Original user message (for context)
 * @returns Smart fallback response
 */
export function getSmartFallback(
  userId: string,
  intent?: string,
  message?: string
): string {
  const ctx = getContext(userId);
  
  // 1. If we have missing fields, ask for the first one
  if (ctx.missingFields.length > 0) {
    const firstMissing = ctx.missingFields[0];
    const prompt = getMissingFieldPrompt(firstMissing);
    
    logger.info('[Fallback] Using missing field prompt', {
      userId,
      state: ctx.state,
      missingField: firstMissing,
    });
    
    return prompt;
  }
  
  // 2. If we're in an active flow, use state-based fallback
  if (ctx.state !== 'IDLE') {
    logger.info('[Fallback] Using state-based fallback', {
      userId,
      state: ctx.state,
    });
    
    return getFallbackByState(userId);
  }
  
  // 3. If we have intent, use intent-based fallback
  if (intent) {
    logger.info('[Fallback] Using intent-based fallback', {
      userId,
      intent,
    });
    
    return getFallbackByIntent(intent);
  }
  
  // 4. Try to detect intent from message
  if (message) {
    const detectedIntent = detectIntentFromMessage(message);
    if (detectedIntent) {
      logger.info('[Fallback] Using detected intent fallback', {
        userId,
        detectedIntent,
      });
      
      return getFallbackByIntent(detectedIntent);
    }
  }
  
  // 5. Default fallback
  logger.info('[Fallback] Using default fallback', { userId });
  return getFallbackByIntent('UNKNOWN');
}

/**
 * Simple intent detection from message for fallback purposes
 */
function detectIntentFromMessage(message: string): string | null {
  const lowerMessage = message.toLowerCase();
  
  // Greeting
  if (/^(halo|hai|hi|hello|selamat|assalam|permisi)/i.test(lowerMessage)) {
    return 'GREETING';
  }
  
  // Complaint
  if (/lapor|keluhan|aduan|rusak|mati|sampah|banjir|tumbang/i.test(lowerMessage)) {
    return 'CREATE_COMPLAINT';
  }
  
  // Reservation
  if (/reservasi|booking|daftar|surat|dokumen|skd|sktm|sku/i.test(lowerMessage)) {
    return 'CREATE_RESERVATION';
  }
  
  // Status check
  if (/status|cek|LAP-|RSV-/i.test(lowerMessage)) {
    return 'CHECK_STATUS';
  }
  
  // Cancel
  if (/batal|cancel|hapus/i.test(lowerMessage)) {
    return 'CANCEL_COMPLAINT';
  }
  
  // History
  if (/riwayat|history|daftar.*saya/i.test(lowerMessage)) {
    return 'HISTORY';
  }
  
  // Thanks
  if (/terima\s*kasih|makasih|thanks/i.test(lowerMessage)) {
    return 'THANKS';
  }
  
  // Knowledge query
  if (/jam|buka|tutup|syarat|biaya|alamat|lokasi|cara|bagaimana/i.test(lowerMessage)) {
    return 'KNOWLEDGE_QUERY';
  }
  
  return null;
}

/**
 * Get error fallback with retry suggestion
 */
export function getErrorFallback(errorType?: string): string {
  const errorTemplates: Record<string, string[]> = {
    'TIMEOUT': [
      'Maaf Kak, prosesnya agak lama nih. Coba kirim ulang pesannya ya 🙏',
      'Waduh, timeout Kak. Silakan coba lagi dalam beberapa saat.',
    ],
    'RATE_LIMIT': [
      'Maaf Kak, sistem sedang sibuk. Coba lagi dalam 1-2 menit ya.',
      'Banyak yang chat nih Kak, tunggu sebentar ya lalu coba lagi.',
    ],
    'SERVICE_DOWN': [
      'Mohon maaf Kak, layanan sedang maintenance. Silakan coba lagi nanti 🙏',
      'Sistem sedang dalam perbaikan Kak. Coba lagi dalam beberapa saat ya.',
    ],
    'DEFAULT': FALLBACK_TEMPLATES['ERROR'],
  };
  
  const templates = errorTemplates[errorType || 'DEFAULT'] || errorTemplates['DEFAULT'];
  return getRandomItem(templates);
}

// ==================== EXPORTS ====================

export default {
  getFallbackByIntent,
  getFallbackByState,
  getMissingFieldPrompt,
  getSmartFallback,
  getErrorFallback,
  FALLBACK_TEMPLATES,
  STATE_FALLBACKS,
  MISSING_FIELD_PROMPTS,
};
