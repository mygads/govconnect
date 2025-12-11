/**
 * Response Templates Service
 * 
 * Pre-defined response templates for common scenarios to reduce LLM calls.
 * 
 * Benefits:
 * - Faster response time
 * - Lower API costs
 * - Consistent responses
 * - Works offline if LLM is down
 */

import logger from '../utils/logger';

// ==================== TYPES ====================

export interface TemplateMatch {
  matched: boolean;
  response?: string;
  intent?: string;
  confidence: number;
}

// ==================== GREETING TEMPLATES ====================

const GREETING_RESPONSES = [
  'Halo Kak! 👋 Saya Gana dari Kelurahan. Ada yang bisa dibantu hari ini?\n\n📋 Lapor masalah\n🎫 Reservasi surat\n📍 Info kelurahan',
  'Hai Kak! 👋 Selamat datang di layanan Kelurahan. Mau lapor masalah, reservasi surat, atau tanya info?',
  'Halo! 👋 Saya siap bantu Kakak. Silakan sampaikan keperluannya ya!',
];

const GREETING_PATTERNS = [
  /^(halo|hai|hi|hello|hey)[\s!.,]*$/i,
  /^(selamat\s+(pagi|siang|sore|malam))[\s!.,]*$/i,
  /^(assalamualaikum|assalamu\'?alaikum)[\s!.,]*$/i,
  /^(permisi|maaf\s+ganggu)[\s!.,]*$/i,
];

// ==================== THANKS TEMPLATES ====================

const THANKS_RESPONSES = [
  'Sama-sama Kak! 😊 Senang bisa membantu. Kalau ada yang lain, langsung chat aja ya!',
  'Terima kasih kembali Kak! 🙏 Jangan sungkan kalau butuh bantuan lagi.',
  'Siap Kak! Semoga harinya menyenangkan ya! 😊',
];

const THANKS_PATTERNS = [
  /^(terima\s*kasih|makasih|thanks|thank\s*you|thx)[\s!.,]*$/i,
  /^(ok|oke|okay|baik|siap)[\s,.]*(terima\s*kasih|makasih)?[\s!.,]*$/i,
  /^(mantap|keren|bagus|good)[\s!.,]*$/i,
];

// ==================== CONFIRMATION TEMPLATES ====================

const CONFIRMATION_RESPONSES = [
  'Baik Kak, ada yang lain yang bisa dibantu?',
  'Siap Kak! Kalau ada pertanyaan lain, langsung tanya aja ya.',
  'Oke Kak! 👍',
];

const CONFIRMATION_PATTERNS = [
  /^(ya|iya|yap|yup|yes)[\s!.,]*$/i,
  /^(ok|oke|okay|okey)[\s!.,]*$/i,
  /^(baik|siap|lanjut)[\s!.,]*$/i,
  /^(sudah|udah|cukup)[\s!.,]*$/i,
];

// ==================== JAM BUKA TEMPLATES ====================

const JAM_BUKA_RESPONSE = `📍 *Jam Operasional Kelurahan*

🕐 Senin - Kamis: 08.00 - 15.00 WIB
🕐 Jumat: 08.00 - 11.30 WIB
🚫 Sabtu & Minggu: Libur

💡 Untuk reservasi, silakan datang 15 menit sebelum jam tutup ya Kak!`;

const JAM_BUKA_PATTERNS = [
  /jam\s*(buka|operasional|kerja|pelayanan)/i,
  /buka\s*jam\s*berapa/i,
  /kapan\s*(buka|tutup)/i,
  /hari\s*apa\s*(buka|libur)/i,
];

// ==================== LOKASI TEMPLATES ====================

const LOKASI_RESPONSE = `📍 *Lokasi Kantor Kelurahan*

🏢 Alamat: Jl. Raya Kelurahan No. 1
📞 Telepon: (022) 123-4567
📱 WhatsApp: 0812-3456-7890

🗺️ Patokan: Sebelah Masjid Al-Ikhlas

💡 Parkir tersedia di halaman depan kantor.`;

const LOKASI_PATTERNS = [
  /dimana\s*(kantor|lokasi|alamat)/i,
  /alamat\s*(kantor|kelurahan)/i,
  /lokasi\s*(kantor|kelurahan)/i,
  /kantor\s*(dimana|di\s*mana)/i,
];

// ==================== LAYANAN TEMPLATES ====================

const LAYANAN_RESPONSE = `📋 *Layanan yang Tersedia*

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

const LAYANAN_PATTERNS = [
  /layanan\s*(apa\s*saja|yang\s*tersedia)/i,
  /apa\s*saja\s*(layanan|surat)/i,
  /jenis\s*(layanan|surat)/i,
  /bisa\s*(urus|buat)\s*apa/i,
];

// ==================== SYARAT UMUM TEMPLATES ====================

const SYARAT_UMUM_RESPONSE = `📋 *Syarat Umum Pengurusan Surat*

Dokumen yang biasanya diperlukan:
1. KTP asli + fotokopi
2. Kartu Keluarga (KK) asli + fotokopi
3. Surat Pengantar RT/RW

💡 Syarat tambahan tergantung jenis surat.
Ketik nama surat untuk info lengkap (contoh: "syarat SKD")`;

const SYARAT_PATTERNS = [
  /syarat\s*(umum|pengurusan)/i,
  /apa\s*saja\s*syarat/i,
  /dokumen\s*apa\s*(saja|yang)/i,
  /perlu\s*bawa\s*apa/i,
];

// ==================== BIAYA TEMPLATES ====================

const BIAYA_RESPONSE = `💰 *Informasi Biaya*

✅ Semua layanan surat di Kelurahan *GRATIS* (tidak dipungut biaya).

⚠️ Jika ada yang meminta bayaran, silakan laporkan ke:
📞 Hotline: 0800-123-4567
📧 Email: pengaduan@kelurahan.go.id

💡 Biaya hanya untuk legalisir di Kecamatan/Notaris.`;

const BIAYA_PATTERNS = [
  /biaya|tarif|harga|bayar/i,
  /berapa\s*(biaya|harga)/i,
  /gratis\s*(atau|apa)/i,
  /ada\s*biaya/i,
];

// ==================== MAIN FUNCTION ====================

/**
 * Try to match message with templates
 * Returns response if matched, null otherwise
 */
export function matchTemplate(message: string): TemplateMatch {
  const cleanMessage = message.trim();

  // Check greetings
  for (const pattern of GREETING_PATTERNS) {
    if (pattern.test(cleanMessage)) {
      return {
        matched: true,
        response: getRandomResponse(GREETING_RESPONSES),
        intent: 'GREETING',
        confidence: 0.95,
      };
    }
  }

  // Check thanks
  for (const pattern of THANKS_PATTERNS) {
    if (pattern.test(cleanMessage)) {
      return {
        matched: true,
        response: getRandomResponse(THANKS_RESPONSES),
        intent: 'THANKS',
        confidence: 0.95,
      };
    }
  }

  // Check confirmations (short messages only)
  if (cleanMessage.length < 15) {
    for (const pattern of CONFIRMATION_PATTERNS) {
      if (pattern.test(cleanMessage)) {
        return {
          matched: true,
          response: getRandomResponse(CONFIRMATION_RESPONSES),
          intent: 'CONFIRMATION',
          confidence: 0.9,
        };
      }
    }
  }

  // Check jam buka
  for (const pattern of JAM_BUKA_PATTERNS) {
    if (pattern.test(cleanMessage)) {
      return {
        matched: true,
        response: JAM_BUKA_RESPONSE,
        intent: 'KNOWLEDGE_QUERY',
        confidence: 0.9,
      };
    }
  }

  // Check lokasi
  for (const pattern of LOKASI_PATTERNS) {
    if (pattern.test(cleanMessage)) {
      return {
        matched: true,
        response: LOKASI_RESPONSE,
        intent: 'KNOWLEDGE_QUERY',
        confidence: 0.9,
      };
    }
  }

  // Check layanan
  for (const pattern of LAYANAN_PATTERNS) {
    if (pattern.test(cleanMessage)) {
      return {
        matched: true,
        response: LAYANAN_RESPONSE,
        intent: 'KNOWLEDGE_QUERY',
        confidence: 0.9,
      };
    }
  }

  // Check syarat
  for (const pattern of SYARAT_PATTERNS) {
    if (pattern.test(cleanMessage)) {
      return {
        matched: true,
        response: SYARAT_UMUM_RESPONSE,
        intent: 'KNOWLEDGE_QUERY',
        confidence: 0.85,
      };
    }
  }

  // Check biaya
  for (const pattern of BIAYA_PATTERNS) {
    if (pattern.test(cleanMessage)) {
      return {
        matched: true,
        response: BIAYA_RESPONSE,
        intent: 'KNOWLEDGE_QUERY',
        confidence: 0.9,
      };
    }
  }

  return { matched: false, confidence: 0 };
}

/**
 * Get random response from array
 */
function getRandomResponse(responses: string[]): string {
  return responses[Math.floor(Math.random() * responses.length)];
}

// ==================== EXPORTS ====================

export default {
  matchTemplate,
};
