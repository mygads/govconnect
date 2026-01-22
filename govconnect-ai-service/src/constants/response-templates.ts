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
  'Halo Kak! 👋 Saya Gana dari Kelurahan. Ada yang bisa dibantu hari ini?\n\n📋 Lapor masalah\n🎫 Reservasi surat\n📍 Info kelurahan',
  'Hai Kak! 👋 Selamat datang di layanan Kelurahan. Mau lapor masalah, reservasi surat, atau tanya info?',
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
  
  'CREATE_RESERVATION': [
    'Baik Kak, untuk reservasi saya perlu beberapa data. Siapa nama lengkap Kakak sesuai KTP?',
    'Oke Kak, saya bantu buatkan reservasi. Boleh sebutkan nama lengkap Kakak?',
    'Baik, untuk pengajuan surat saya perlu data Kakak. Nama lengkap sesuai KTP siapa ya?',
  ],
  
  'CHECK_STATUS': [
    'Untuk cek status, boleh sebutkan nomor laporan atau reservasinya Kak? (contoh: LAP-20251201-001)',
    'Baik Kak, mau cek status yang mana? Sebutkan nomornya ya (LAP-xxx atau RSV-xxx)',
    'Oke, saya bantu cek. Nomor laporan atau reservasinya berapa Kak?',
  ],
  
  'CANCEL_COMPLAINT': [
    'Untuk membatalkan laporan, boleh sebutkan nomornya Kak? (contoh: LAP-20251201-001)',
    'Baik Kak, mau batalkan laporan yang mana? Sebutkan nomornya ya.',
  ],
  
  'CANCEL_RESERVATION': [
    'Untuk membatalkan reservasi, boleh sebutkan nomornya Kak? (contoh: RSV-20251201-001)',
    'Baik Kak, mau batalkan reservasi yang mana? Sebutkan nomornya ya.',
  ],
  
  'UPDATE_RESERVATION': [
    'Baik Kak, mau ubah jadwal reservasi ya. Boleh sebutkan nomor reservasinya dan mau diubah ke tanggal/jam berapa?',
    'Oke Kak, untuk reschedule sebutkan nomor reservasi dan jadwal barunya ya.',
  ],
  
  'HISTORY': [
    'Mohon tunggu sebentar ya Kak, saya cek riwayat laporan dan reservasi Kakak...',
    'Baik Kak, saya lihat dulu riwayatnya ya...',
  ],
  
  'KNOWLEDGE_QUERY': [
    'Untuk informasi tersebut, Kakak bisa:\n\n📞 Hubungi: (022) 123-4567\n🕐 Jam kerja: Senin-Jumat 08:00-15:00\n📍 Datang langsung ke kantor kelurahan',
    'Maaf Kak, saya belum punya info lengkap tentang itu. Silakan hubungi kantor kelurahan langsung ya di jam kerja.',
  ],
  
  'THANKS': THANKS_RESPONSES,
  
  'CONFIRMATION': [
    'Baik Kak, saya proses ya. Mohon tunggu sebentar...',
    'Oke Kak, sedang saya proses...',
  ],
  
  'REJECTION': REJECTION_RESPONSES,
  
  'QUESTION': [
    'Halo! Saya Gana dari Kelurahan. Ada yang bisa saya bantu hari ini?',
    'Hai Kak! Mau lapor masalah, reservasi surat, atau tanya info?',
  ],
  
  'EMERGENCY_FIRE': [
    '🚨 *DARURAT KEBAKARAN!*\n\nSegera hubungi:\n🔥 *Damkar Sektor Bola: 113* atau *(022) 123456*\n📞 Call Center: 112\n\n⚠️ *Langkah darurat:*\n1. Evakuasi semua orang\n2. Jauhi sumber api\n3. Jangan gunakan lift\n4. Tutup hidung dengan kain basah\n\n🙏 Tetap tenang, bantuan segera datang!',
    '🔥 *KEBAKARAN - HUBUNGI SEGERA:*\n\n📞 *Damkar Sektor Bola: 113*\n📞 *Hotline: (022) 123456*\n📞 *Call Center 112*\n\nSelamatkan diri dan keluarga terlebih dahulu! Jangan kembali ke dalam bangunan yang terbakar.',
  ],
  
  'UNKNOWN': [
    'Maaf Kak, bisa dijelaskan lebih detail? Saya siap bantu untuk:\n\n📋 Lapor masalah (jalan rusak, lampu mati, dll)\n🎫 Reservasi surat (SKD, SKTM, dll)\n📍 Info kelurahan',
    'Hmm, saya kurang paham Kak. Kakak mau:\n\n1️⃣ Lapor masalah?\n2️⃣ Urus surat?\n3️⃣ Cek status?\n\nSilakan pilih atau jelaskan lebih detail ya.',
    'Maaf Kak, coba jelaskan lagi ya. Saya bisa bantu:\n\n• Laporan keluhan/aduan\n• Reservasi layanan surat\n• Informasi kelurahan',
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
