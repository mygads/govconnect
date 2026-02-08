/**
 * Daftar Layanan Pemerintahan Kelurahan
 * Layanan ini sudah fix dan tidak bisa ditambah/dihapus oleh admin
 * Admin hanya bisa mengaktifkan/menonaktifkan layanan
 */

export interface ServiceDefinition {
  code: string;
  name: string;
  description: string;
  category: 'administrasi' | 'perizinan' | 'kependudukan' | 'sosial';
  requirements: string[];
  sop_steps: string[];
  estimated_duration: number; // dalam menit
  daily_quota: number;
  citizen_questions: CitizenQuestion[]; // pertanyaan spesifik per layanan
}

export interface CitizenQuestion {
  field: string;
  question: string;
  type: 'text' | 'number' | 'date' | 'select';
  required: boolean;
  options?: string[]; // untuk type select
}

// Pertanyaan data umum warga (WAJIB untuk semua layanan)
export const COMMON_CITIZEN_QUESTIONS: CitizenQuestion[] = [
  {
    field: 'nama_lengkap',
    question: 'Siapa nama lengkap Bapak/Ibu sesuai KTP?',
    type: 'text',
    required: true,
  },
  {
    field: 'nik',
    question: 'Berapa NIK (Nomor Induk Kependudukan) Bapak/Ibu?',
    type: 'text',
    required: true,
  },
  {
    field: 'alamat',
    question: 'Alamat tempat tinggal Bapak/Ibu di mana?',
    type: 'text',
    required: true,
  },
  {
    field: 'no_hp',
    question: 'Nomor HP yang bisa dihubungi?',
    type: 'text',
    required: true,
  },
];

// NOTE: GOVERNMENT_SERVICES, helper functions (getServiceByCode, getServicesByCategory,
// getQuestionsForService), and DEFAULT_OPERATING_HOURS were removed — dead code never imported.
// Service definitions are managed via database seed, not hardcoded constants.
