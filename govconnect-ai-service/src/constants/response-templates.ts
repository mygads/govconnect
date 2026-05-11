/**
 * Response Templates Constants
 * 
 * SINGLE SOURCE OF TRUTH untuk semua response templates.
 * Menggabungkan:
 * - response-templates.service.ts
 * - fallback-response.service.ts
 * 
 * Digunakan untuk:
 * - Quick responses tanpa LLM
 * - Fallback responses saat LLM gagal
 * - Missing field prompts
 */

import { getVillageDateTime } from '../utils/wib-datetime';

// ==================== TIME-BASED GREETING ====================

/**
 * Get current time-based greeting in village timezone.
 */
export function getTimeBasedGreeting(timezone?: string | null): string {
  const { timeOfDay } = getVillageDateTime(timezone);
  if (timeOfDay === 'pagi') return 'Selamat pagi';
  if (timeOfDay === 'siang') return 'Selamat siang';
  if (timeOfDay === 'sore') return 'Selamat sore';
  return 'Selamat malam';
}

/**
 * Get dynamic greeting response based on current time
 */
export function getDynamicGreetingResponse(timezone?: string | null): string {
  const timeGreeting = getTimeBasedGreeting(timezone);
  const variants = [
    `${timeGreeting}! Selamat datang di layanan GovConnect.\nBoleh kami tahu nama Bapak/Ibu terlebih dahulu?`,
    `${timeGreeting}, selamat datang di layanan GovConnect.\nMohon informasikan nama Bapak/Ibu agar kami bisa membantu dengan tepat.`,
    `${timeGreeting}! Selamat datang di layanan GovConnect.\nSebelum melanjutkan, mohon tuliskan nama Bapak/Ibu.`,
  ];
  return variants[Math.floor(Math.random() * variants.length)];
}

// ==================== GREETING RESPONSES ====================

export const GREETING_RESPONSES = [
  'Selamat datang di layanan GovConnect.\nBoleh kami tahu nama Bapak/Ibu terlebih dahulu?',
  'Selamat datang di layanan GovConnect.\nMohon informasikan nama Bapak/Ibu agar kami bisa membantu dengan tepat.',
  'Selamat datang di layanan GovConnect.\nSebelum melanjutkan, mohon tuliskan nama Bapak/Ibu.',
];

// ==================== THANKS RESPONSES ====================

export const THANKS_RESPONSES = [
  'Sama-sama Pak/Bu. Senang bisa membantu. Jika ada yang lain, silakan sampaikan.',
  'Terima kasih kembali Pak/Bu. Jangan sungkan jika butuh bantuan lagi.',
  'Baik Pak/Bu. Semoga harinya menyenangkan.',
];

// ==================== CONFIRMATION RESPONSES ====================

export const CONFIRMATION_RESPONSES = [
  'Baik Pak/Bu, ada hal lain yang bisa kami bantu?',
  'Siap Pak/Bu. Jika ada pertanyaan lain, silakan disampaikan.',
  'Baik Pak/Bu.',
];

// ==================== REJECTION RESPONSES ====================

export const REJECTION_RESPONSES = [
  'Baik Pak/Bu, tidak masalah. Ada hal lain yang bisa kami bantu?',
  'Baik Pak/Bu, pembatalan dibatalkan. Mau dibantu yang lain?',
];

// ==================== FALLBACK TEMPLATES BY INTENT ====================

export const FALLBACK_TEMPLATES: Record<string, string[]> = {
  'GREETING': GREETING_RESPONSES,
  
  'CREATE_COMPLAINT': [
    'Baik Pak/Bu, mohon sebutkan lokasi laporan secara jelas.',
    'Baik Pak/Bu, masalahnya di lokasi mana tepatnya?',
    'Baik Pak/Bu, mohon sebutkan alamat lengkapnya.',
  ],
  
  'CREATE_SERVICE_REQUEST': [
    'Baik Pak/Bu, layanan apa yang ingin diajukan?',
    'Baik Pak/Bu, mohon sebutkan nama layanan yang dibutuhkan.',
    'Untuk pengajuan layanan, mohon sebutkan nama layanan yang diinginkan.',
  ],
  
  'CHECK_STATUS': [
    'Untuk cek status, mohon sebutkan nomor laporan atau layanan (contoh: LAP-20251201-001 atau LAY-20251201-001).',
    'Baik Pak/Bu, mohon sebutkan nomor yang ingin dicek (LAP-xxx atau LAY-xxx).',
    'Baik Pak/Bu, nomor laporan atau layanan berapa?',
  ],
  
  'CANCEL_COMPLAINT': [
    'Untuk membatalkan laporan, mohon sebutkan nomornya (contoh: LAP-20251201-001).',
    'Baik Pak/Bu, laporan mana yang ingin dibatalkan? Sebutkan nomornya ya.',
  ],
  
  'HISTORY': [
    'Mohon tunggu sebentar, kami cek riwayat laporan dan layanan Bapak/Ibu...',
    'Baik Pak/Bu, kami cek riwayatnya ya...',
  ],
  
  'KNOWLEDGE_QUERY': [
    'Mohon maaf Pak/Bu, saya belum bisa memastikan informasi yang dimaksud dari data yang tersedia saat ini. Kalau berkenan, sebutkan topik atau nama layanannya lebih spesifik ya.',
    'Mohon maaf Pak/Bu, saya belum menemukan informasi yang cukup tepat untuk pertanyaan tadi. Boleh diperjelas sedikit, misalnya nama layanan, dokumen, atau kebutuhan yang ingin dicek?',
  ],
  
  'THANKS': THANKS_RESPONSES,
  
  'CONFIRMATION': [
    'Baik Pak/Bu, kami proses ya. Mohon tunggu sebentar...',
    'Baik Pak/Bu, sedang kami proses...',
  ],
  
  'REJECTION': REJECTION_RESPONSES,
  
  'QUESTION': [
    'Halo, selamat datang di layanan GovConnect. Ada yang bisa kami bantu hari ini?',
    'Selamat datang Pak/Bu. Mau lapor masalah, ajukan layanan, atau tanya info?',
  ],
  
  'UNKNOWN': [
    'Maaf Pak/Bu, saya siap bantu, tetapi maksud pesan tadi belum terlalu jelas. Bapak/Ibu mau lapor masalah, urus layanan administrasi, atau minta info desa?',
    'Maaf Pak/Bu, saya belum menangkap kebutuhan Bapak/Ibu dengan jelas. Kalau berkenan, balas singkat saja: lapor masalah, urus surat/layanan, atau cek status.',
    'Maaf Pak/Bu, boleh dijelaskan sedikit lagi? Saya bisa bantu untuk pengaduan, layanan administrasi, atau informasi desa/kelurahan.',
  ],
  
  'ERROR': [
    'Mohon maaf Pak/Bu, sistem kami sedang ada kendala sebentar. Saya mengerti ini merepotkan — mohon coba kirim ulang pesannya ya. Kalau masih belum bisa, saya bantu hubungkan ke petugas desa langsung.',
    'Mohon maaf Pak/Bu, jawabannya belum berhasil kami proses saat ini. Silakan kirim ulang sebentar lagi — kalau masih terkendala, sebutkan saja keperluan Bapak/Ibu, nanti saya catat dan arahkan ke petugas.',
    'Mohon maaf Pak/Bu, ada kendala dari sisi kami. Coba ulangi pesan tadi ya. Kalau sudah beberapa kali belum berhasil, balas *petugas* dan saya teruskan ke staff desa.',
  ],
};

// ==================== MISSING FIELD PROMPTS ====================

export const MISSING_FIELD_PROMPTS: Record<string, string[]> = {
  // Complaint fields
  'kategori': [
    'Jenis masalah apa yang ingin dilaporkan Pak/Bu? Ceritakan saja, kami siap membantu.',
    'Masalahnya tentang apa Pak/Bu? Silakan jelaskan secara singkat.',
  ],
  'alamat': [
    'Di mana lokasi masalahnya Pak/Bu? Sebutkan alamat atau patokan terdekat.',
    'Lokasinya di mana Pak/Bu? Bisa sebutkan alamat lengkapnya?',
  ],
  'deskripsi': [
    'Bisa jelaskan lebih detail masalahnya Pak/Bu?',
    'Kondisinya seperti apa Pak/Bu? Ceritakan lebih detail.',
  ],
  
  // Service request fields
  'service_slug': [
    'Layanan apa yang ingin Bapak/Ibu ajukan?',
    'Mau urus layanan apa Pak/Bu? (contoh: surat domisili, surat pengantar, dll)',
  ],
  'service_id': [
    'Layanan yang dimaksud apa ya Pak/Bu? Mohon sebutkan nama layanannya.',
    'Boleh sebutkan nama layanan yang ingin diajukan?',
  ],
};

// ==================== ERROR TEMPLATES ====================

export const ERROR_TEMPLATES: Record<string, string[]> = {
  'TIMEOUT': [
    'Maaf Pak/Bu, prosesnya belum sempat selesai karena sistem kami sedang lambat. Coba kirim ulang pesannya sebentar lagi ya.',
    'Maaf Pak/Bu, pengecekannya butuh waktu lebih lama dari biasanya. Silakan coba lagi beberapa saat lagi, nanti saya bantu lanjutkan.',
  ],
  'RATE_LIMIT': [
    'Maaf Pak/Bu, antrian pesan sedang ramai. Coba kirim lagi dalam 1-2 menit ya, nanti saya bantu lanjutkan.',
    'Maaf Pak/Bu, sistem sedang padat sebentar. Silakan coba lagi ya, biasanya tidak lama.',
  ],
  'SERVICE_DOWN': [
    'Maaf Pak/Bu, layanan sedang kami perbaiki sebentar. Silakan coba lagi nanti; kalau masih terkendala, saya bantu arahkan ke petugas desa.',
    'Maaf Pak/Bu, sistem sedang dalam perbaikan dari sisi kami. Coba lagi beberapa saat ya, nanti saya bantu lanjutkan.',
  ],
  'DEFAULT': FALLBACK_TEMPLATES['ERROR'],
};

// ==================== HELPER FUNCTIONS ====================

/**
 * Get random item from array
 */
export function getRandomItem<T>(items: T[]): T {
  return items[Math.floor(Math.random() * items.length)];
}

/**
 * Get fallback response by intent
 * For GREETING intent, uses dynamic time-based greeting
 */
export function getFallbackByIntent(intent: string, timezone?: string | null): string {
  // Special handling for GREETING - use dynamic time-based greeting
  if (intent === 'GREETING') {
    return getDynamicGreetingResponse(timezone);
  }
  
  const templates = FALLBACK_TEMPLATES[intent] || FALLBACK_TEMPLATES['UNKNOWN'];
  return getRandomItem(templates);
}

/**
 * Get missing field prompt
 */
export function getMissingFieldPrompt(field: string): string {
  const prompts = MISSING_FIELD_PROMPTS[field];
  if (prompts) {
    return getRandomItem(prompts);
  }
  return `Boleh sebutkan ${field.replace(/_/g, ' ')} Bapak/Ibu?`;
}

/**
 * Get error fallback
 */
export function getErrorFallback(errorType?: string): string {
  const templates = ERROR_TEMPLATES[errorType || 'DEFAULT'] || ERROR_TEMPLATES['DEFAULT'];
  return getRandomItem(templates);
}

export default {
  GREETING_RESPONSES,
  THANKS_RESPONSES,
  CONFIRMATION_RESPONSES,
  REJECTION_RESPONSES,
  FALLBACK_TEMPLATES,
  MISSING_FIELD_PROMPTS,
  ERROR_TEMPLATES,
  getRandomItem,
  getFallbackByIntent,
  getMissingFieldPrompt,
  getErrorFallback,
  getTimeBasedGreeting,
  getDynamicGreetingResponse,
};
