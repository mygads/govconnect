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

import { IntentType } from './intent-patterns';

// ==================== TIME-BASED GREETING ====================

/**
 * Get current time-based greeting in WIB timezone
 */
export function getTimeBasedGreeting(): string {
  // Get current time in WIB (UTC+7)
  const now = new Date();
  const wibOffset = 7 * 60; // WIB is UTC+7
  const utc = now.getTime() + (now.getTimezoneOffset() * 60000);
  const wibTime = new Date(utc + (wibOffset * 60000));
  const hour = wibTime.getHours();
  
  if (hour >= 5 && hour < 11) {
    return 'Selamat pagi';
  } else if (hour >= 11 && hour < 15) {
    return 'Selamat siang';
  } else if (hour >= 15 && hour < 18) {
    return 'Selamat sore';
  } else {
    return 'Selamat malam';
  }
}

/**
 * Get dynamic greeting response based on current time
 */
export function getDynamicGreetingResponse(): string {
  const timeGreeting = getTimeBasedGreeting();
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
    'Mohon maaf Pak/Bu, informasi tersebut belum tersedia.\nSilakan datang langsung ke kantor desa untuk bantuan lebih lanjut.',
    'Mohon maaf Pak/Bu, informasi terkait hal tersebut belum tersedia.\nSilakan datang ke kantor desa pada jam kerja.',
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
    'Mohon maaf Pak/Bu, bisa dijelaskan lebih detail? Kami siap bantu untuk:\n\n• Lapor masalah (jalan rusak, lampu mati, dll)\n• Ajukan layanan (surat keterangan, pengantar, dll)\n• Info kelurahan',
    'Mohon maaf Pak/Bu, kami kurang paham. Bapak/Ibu ingin:\n\n1) Lapor masalah\n2) Urus surat/layanan\n3) Cek status\n\nSilakan pilih atau jelaskan lebih detail.',
    'Mohon maaf Pak/Bu, silakan jelaskan lagi. Kami bisa bantu:\n\n• Laporan keluhan/aduan\n• Ajukan layanan\n• Informasi kelurahan',
  ],
  
  'ERROR': [
    'Mohon maaf Pak/Bu, ada kendala teknis. Silakan ulangi pesan Anda.',
    'Mohon maaf Pak/Bu, sistem sedang sibuk. Silakan coba lagi dalam beberapa saat.',
    'Mohon maaf Pak/Bu, terjadi gangguan teknis. Silakan kirim ulang pesannya.',
  ],
};

// ==================== MISSING FIELD PROMPTS ====================

export const MISSING_FIELD_PROMPTS: Record<string, string[]> = {
  // Complaint fields
  'kategori': [
    'Jenis masalah apa yang ingin dilaporkan Pak/Bu? (jalan rusak, lampu mati, sampah, dll)',
    'Masalahnya tentang apa Pak/Bu? Jalan rusak, lampu mati, atau yang lain?',
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
    'Mohon maaf Pak/Bu, prosesnya agak lama. Silakan kirim ulang pesannya.',
    'Mohon maaf Pak/Bu, terjadi timeout. Silakan coba lagi dalam beberapa saat.',
  ],
  'RATE_LIMIT': [
    'Mohon maaf Pak/Bu, sistem sedang sibuk. Coba lagi dalam 1-2 menit.',
    'Mohon maaf Pak/Bu, sistem sedang padat. Silakan coba lagi sebentar.',
  ],
  'SERVICE_DOWN': [
    'Mohon maaf Pak/Bu, layanan sedang maintenance. Silakan coba lagi nanti.',
    'Mohon maaf Pak/Bu, sistem sedang dalam perbaikan. Coba lagi dalam beberapa saat.',
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
export function getFallbackByIntent(intent: string): string {
  // Special handling for GREETING - use dynamic time-based greeting
  if (intent === 'GREETING') {
    return getDynamicGreetingResponse();
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
