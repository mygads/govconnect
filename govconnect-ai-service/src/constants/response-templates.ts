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

// ==================== GREETING RESPONSES ====================

export const GREETING_RESPONSES = [
  'Halo Kak! 👋 Saya Gana dari Kelurahan. Ada yang bisa dibantu hari ini?\n\n📋 Lapor masalah\n📝 Ajukan layanan\n📍 Info kelurahan',
  'Hai Kak! 👋 Selamat datang di layanan Kelurahan. Mau lapor masalah, ajukan layanan, atau tanya info?',
  'Halo! 👋 Saya siap bantu Kakak. Silakan sampaikan keperluannya ya!',
];

// ==================== THANKS RESPONSES ====================

export const THANKS_RESPONSES = [
  'Sama-sama Kak! 😊 Senang bisa membantu. Kalau ada yang lain, langsung chat aja ya!',
  'Terima kasih kembali Kak! 🙏 Jangan sungkan kalau butuh bantuan lagi.',
  'Siap Kak! Semoga harinya menyenangkan ya! 😊',
];

// ==================== CONFIRMATION RESPONSES ====================

export const CONFIRMATION_RESPONSES = [
  'Baik Kak, ada yang lain yang bisa dibantu?',
  'Siap Kak! Kalau ada pertanyaan lain, langsung tanya aja ya.',
  'Oke Kak! 👍',
];

// ==================== REJECTION RESPONSES ====================

export const REJECTION_RESPONSES = [
  'Baik Kak, tidak masalah. Ada yang lain yang bisa saya bantu?',
  'Oke Kak, dibatalkan ya. Mau dibantu yang lain?',
];

// ==================== FALLBACK TEMPLATES BY INTENT ====================

export const FALLBACK_TEMPLATES: Record<string, string[]> = {
  'GREETING': GREETING_RESPONSES,
  
  'CREATE_COMPLAINT': [
    'Baik Kak, saya bantu catat laporan. Boleh sebutkan lokasinya di mana?',
    'Saya catat ya Kak. Masalahnya di lokasi mana tepatnya?',
    'Oke Kak, saya bantu proses laporan. Bisa sebutkan alamat lengkapnya?',
  ],
  
  'CREATE_SERVICE_REQUEST': [
    'Baik Kak, layanan apa yang ingin diajukan?',
    'Oke Kak, mau ajukan layanan apa?',
    'Baik, untuk pengajuan layanan, mohon sebutkan nama layanan yang dibutuhkan ya Kak.',
  ],
  
  'CHECK_STATUS': [
    'Untuk cek status, boleh sebutkan nomor laporan atau layanan ya Kak? (contoh: LAP-20251201-001 atau LAY-20251201-001)',
    'Baik Kak, mau cek status yang mana? Sebutkan nomornya ya (LAP-xxx atau LAY-xxx)',
    'Oke, saya bantu cek. Nomor laporan atau layanan berapa Kak?',
  ],
  
  'CANCEL_COMPLAINT': [
    'Untuk membatalkan laporan, boleh sebutkan nomornya Kak? (contoh: LAP-20251201-001)',
    'Baik Kak, mau batalkan laporan yang mana? Sebutkan nomornya ya.',
  ],
  
  'HISTORY': [
    'Mohon tunggu sebentar ya Kak, saya cek riwayat laporan dan layanan Kakak...',
    'Baik Kak, saya lihat dulu riwayatnya ya...',
  ],
  
  'KNOWLEDGE_QUERY': [
    'Untuk informasi tersebut, Kakak bisa:\n\n📞 Hubungi: (022) 123-4567\n🕐 Jam kerja: Senin-Jumat 08:00-15:00\n📍 Datang langsung ke kantor kelurahan',
    'Biar saya bantu cek yang tepat ya Kak. Informasi yang Kakak cari ini tentang *apa*? (contoh: jam buka, alamat kantor, syarat layanan tertentu, atau kontak RT/RW)\n\nKalau perlu cepat, Kakak juga bisa hubungi kantor kelurahan di jam kerja ya.',
  ],
  
  'THANKS': THANKS_RESPONSES,
  
  'CONFIRMATION': [
    'Baik Kak, saya proses ya. Mohon tunggu sebentar...',
    'Oke Kak, sedang saya proses...',
  ],
  
  'REJECTION': REJECTION_RESPONSES,
  
  'QUESTION': [
    'Halo! Saya Gana dari Kelurahan. Ada yang bisa saya bantu hari ini?',
    'Hai Kak! Mau lapor masalah, ajukan layanan, atau tanya info?',
  ],
  
  'UNKNOWN': [
    'Biar saya bantu dengan tepat ya Kak. Ini terkait apa?\n\n1️⃣ Lapor masalah (jalan rusak, lampu mati, sampah, banjir, dll)\n2️⃣ Urus layanan surat (SKTM, SKU, Domisili, Pengantar KTP/KK, dll)\n3️⃣ Cek status (kirim nomor LAP-... atau LAY-...)\n4️⃣ Info kelurahan (alamat, jam buka, kontak)\n\nKakak pilih nomor atau tulis singkat kebutuhan Kakak ya.',
    'Boleh sebutkan topiknya ya Kak? Contoh: "syarat SKTM", "lapor lampu mati", "cek status LAP-20260122-001", atau "jam buka kelurahan".',
    'Agar cepat saya proses, mohon kirim salah satu ini ya Kak:\n- Jika *lapor masalah*: jenis masalah + lokasi/patokan\n- Jika *urus layanan*: nama layanan yang dibutuhkan\n- Jika *cek status*: nomor LAP-... atau LAY-...\n- Jika *info kelurahan*: yang ingin ditanyakan (alamat/jam/kontak)',
  ],
  
  'ERROR': [
    'Mohon maaf Kak, ada kendala teknis 🙏 Coba ulangi pesan Kakak ya.',
    'Maaf Kak, sistem sedang sibuk. Silakan coba lagi dalam beberapa saat.',
    'Waduh, ada gangguan teknis nih Kak. Coba kirim ulang pesannya ya 🙏',
  ],
};

// ==================== KNOWLEDGE TEMPLATES ====================

export const JAM_BUKA_RESPONSE = `📍 *Jam Operasional Kelurahan*

🕐 Senin - Jumat: 08.00 - 15.00 WIB
🕐 Sabtu: 08.00 - 12.00 WIB
🚫 Minggu & Hari Libur: Tutup
⏸️ Istirahat: 12.00 - 13.00 WIB

💡 Waktu terbaik: pagi jam 08.00-10.00 WIB ya Kak!`;

export const LOKASI_RESPONSE = `📍 *Lokasi Kantor Kelurahan*

🏢 Alamat: Jl. Raya Kelurahan No. 1
📞 Telepon: (022) 123-4567
📱 WhatsApp: 0812-3456-7890

🗺️ Patokan: Sebelah Masjid Al-Ikhlas

💡 Parkir tersedia di halaman depan kantor.`;

export const LAYANAN_RESPONSE = `📋 *Layanan yang Tersedia*

📄 *Surat Keterangan:*
• SKD - Surat Keterangan Domisili
• SKTM - Surat Keterangan Tidak Mampu
• SKU - Surat Keterangan Usaha

📝 *Surat Pengantar:*
• SPKTP - Pengantar KTP
• SPKK - Pengantar Kartu Keluarga
• SPSKCK - Pengantar SKCK
• SPAKTA - Pengantar Akta

🎉 *Izin:*
• IKR - Izin Keramaian

💡 Ketik nama layanan untuk info lebih lanjut!`;

export const SYARAT_UMUM_RESPONSE = `📋 *Syarat Umum Pengurusan Surat*

Dokumen yang biasanya diperlukan:
1. KTP asli + fotokopi
2. Kartu Keluarga (KK) asli + fotokopi
3. Surat Pengantar RT/RW

💡 Syarat tambahan tergantung jenis surat.
Ketik nama surat untuk info lengkap (contoh: "syarat SKD")`;

export const BIAYA_RESPONSE = `💰 *Informasi Biaya*

✅ Semua layanan surat di Kelurahan *GRATIS* (tidak dipungut biaya).

⚠️ Jika ada yang meminta bayaran, silakan laporkan ke:
📞 Hotline: 0800-123-4567
📧 Email: pengaduan@kelurahan.go.id

💡 Biaya hanya untuk legalisir di Kecamatan/Notaris.`;

// ==================== MISSING FIELD PROMPTS ====================

export const MISSING_FIELD_PROMPTS: Record<string, string[]> = {
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
  
  // Service request fields
  'service_slug': [
    'Layanan apa yang ingin Kakak ajukan?',
    'Mau urus layanan apa Kak? (contoh: surat domisili, surat pengantar, dll)',
  ],
  'service_id': [
    'Layanan yang dimaksud apa ya Kak? Mohon sebutkan nama layanannya.',
    'Boleh sebutkan nama layanan yang ingin diajukan?',
  ],
};

// ==================== ERROR TEMPLATES ====================

export const ERROR_TEMPLATES: Record<string, string[]> = {
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

// ==================== HELPER FUNCTIONS ====================

/**
 * Get random item from array
 */
export function getRandomItem<T>(items: T[]): T {
  return items[Math.floor(Math.random() * items.length)];
}

/**
 * Get fallback response by intent
 */
export function getFallbackByIntent(intent: string): string {
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
  return `Boleh sebutkan ${field.replace(/_/g, ' ')} Kakak?`;
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
  JAM_BUKA_RESPONSE,
  LOKASI_RESPONSE,
  LAYANAN_RESPONSE,
  SYARAT_UMUM_RESPONSE,
  BIAYA_RESPONSE,
  MISSING_FIELD_PROMPTS,
  ERROR_TEMPLATES,
  getRandomItem,
  getFallbackByIntent,
  getMissingFieldPrompt,
  getErrorFallback,
};
