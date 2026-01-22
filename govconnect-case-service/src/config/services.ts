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
    question: 'Siapa nama lengkap Kakak sesuai KTP?',
    type: 'text',
    required: true,
  },
  {
    field: 'nik',
    question: 'Berapa NIK (Nomor Induk Kependudukan) Kakak?',
    type: 'text',
    required: true,
  },
  {
    field: 'alamat',
    question: 'Alamat tempat tinggal Kakak di mana?',
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

// Daftar layanan tetap kelurahan
// Sesuai dengan Knowledge Base KB-13-SOP-Layanan-Kelurahan.txt
export const GOVERNMENT_SERVICES: ServiceDefinition[] = [
  // ==================== ADMINISTRASI ====================
  {
    code: 'SKD',
    name: 'Surat Keterangan Domisili',
    description: 'Surat resmi dari kelurahan yang menyatakan bahwa seseorang benar-benar bertempat tinggal di alamat tertentu dalam wilayah kelurahan tersebut. Kegunaan: pembukaan rekening bank, melamar pekerjaan, mendaftar sekolah/kuliah, mengurus BPJS/asuransi.',
    category: 'administrasi',
    requirements: [
      'KTP asli dan fotokopi (2 lembar)',
      'Kartu Keluarga (KK) asli dan fotokopi',
      'Surat Pengantar dari RT/RW',
      'Pas foto 3x4 (2 lembar)',
      'Bukti tempat tinggal (sertifikat/surat sewa/surat keterangan menumpang)',
    ],
    sop_steps: [
      'Minta surat pengantar dari RT/RW setempat',
      'Datang ke kantor kelurahan dengan membawa semua persyaratan',
      'Ambil nomor antrian di loket',
      'Serahkan berkas ke petugas',
      'Tunggu proses verifikasi (15-30 menit)',
      'Ambil SKD yang sudah jadi',
    ],
    estimated_duration: 30,
    daily_quota: 30,
    citizen_questions: [
      {
        field: 'keperluan',
        question: 'Surat domisili ini untuk keperluan apa? (contoh: buka rekening, melamar kerja, daftar sekolah)',
        type: 'text',
        required: true,
      },
    ],
  },
  {
    code: 'SKU',
    name: 'Surat Keterangan Usaha',
    description: 'Surat resmi dari kelurahan yang menyatakan bahwa seseorang memiliki usaha di wilayah kelurahan tersebut. SKU biasanya untuk usaha mikro dan kecil. Kegunaan: pengajuan pinjaman bank/koperasi, pendaftaran BPJS Ketenagakerjaan, mengurus NIB.',
    category: 'administrasi',
    requirements: [
      'KTP asli dan fotokopi pemilik usaha',
      'Kartu Keluarga (KK) fotokopi',
      'Surat Pengantar dari RT/RW',
      'Pas foto 3x4 (2 lembar)',
      'Foto tempat usaha (tampak depan)',
      'Surat pernyataan memiliki usaha',
    ],
    sop_steps: [
      'Minta surat pengantar dari RT/RW',
      'Siapkan foto tempat usaha',
      'Datang ke kantor kelurahan dengan semua persyaratan',
      'Isi formulir permohonan SKU',
      'Serahkan berkas ke petugas',
      'Tunggu verifikasi (petugas mungkin survey lokasi)',
      'Ambil SKU yang sudah jadi',
    ],
    estimated_duration: 60,
    daily_quota: 20,
    citizen_questions: [
      {
        field: 'nama_usaha',
        question: 'Apa nama usaha Kakak?',
        type: 'text',
        required: true,
      },
      {
        field: 'jenis_usaha',
        question: 'Jenis usahanya apa? (contoh: warung makan, toko kelontong, bengkel)',
        type: 'text',
        required: true,
      },
      {
        field: 'alamat_usaha',
        question: 'Di mana alamat lokasi usahanya?',
        type: 'text',
        required: true,
      },
    ],
  },
  {
    code: 'SKTM',
    name: 'Surat Keterangan Tidak Mampu',
    description: 'Surat resmi dari kelurahan yang menyatakan bahwa seseorang atau keluarga termasuk dalam kategori kurang mampu secara ekonomi. Kegunaan: keringanan biaya pendidikan (SPP, UKT), beasiswa, keringanan biaya rumah sakit, bantuan sosial, KIP, KIS.',
    category: 'sosial',
    requirements: [
      'KTP asli dan fotokopi pemohon',
      'Kartu Keluarga (KK) asli dan fotokopi',
      'Surat Pengantar dari RT/RW yang menyatakan kondisi ekonomi',
      'Pas foto 3x4 (2 lembar)',
      'Surat pernyataan tidak mampu (bermaterai)',
    ],
    sop_steps: [
      'Minta surat pengantar dari RT/RW dengan keterangan kondisi ekonomi',
      'Isi surat pernyataan tidak mampu (form tersedia di kelurahan)',
      'Datang ke kantor kelurahan dengan semua persyaratan',
      'Serahkan berkas ke petugas',
      'Tunggu verifikasi dan tanda tangan Lurah',
      'Ambil SKTM yang sudah jadi',
    ],
    estimated_duration: 60,
    daily_quota: 15,
    citizen_questions: [
      {
        field: 'keperluan',
        question: 'SKTM ini untuk keperluan apa? (contoh: beasiswa, keringanan biaya RS, bantuan sosial)',
        type: 'text',
        required: true,
      },
      {
        field: 'pekerjaan',
        question: 'Apa pekerjaan Kakak saat ini?',
        type: 'text',
        required: false,
      },
    ],
  },
  {
    code: 'SKBM',
    name: 'Surat Keterangan Belum Menikah',
    description: 'Surat resmi dari kelurahan yang menyatakan bahwa seseorang belum pernah menikah atau saat ini berstatus belum menikah. Kegunaan: melamar pekerjaan (terutama perusahaan asing), pengajuan visa ke luar negeri, pendaftaran CPNS/TNI/Polri.',
    category: 'administrasi',
    requirements: [
      'KTP asli dan fotokopi',
      'Kartu Keluarga (KK) asli dan fotokopi',
      'Surat Pengantar dari RT/RW',
      'Pas foto 3x4 (2 lembar)',
      'Akta Kelahiran (fotokopi)',
    ],
    sop_steps: [
      'Minta surat pengantar dari RT/RW',
      'Datang ke kantor kelurahan dengan semua persyaratan',
      'Isi formulir permohonan SKBM',
      'Serahkan berkas ke petugas',
      'Tunggu proses verifikasi',
      'Ambil SKBM yang sudah jadi',
    ],
    estimated_duration: 30,
    daily_quota: 20,
    citizen_questions: [
      {
        field: 'keperluan',
        question: 'Surat ini untuk keperluan apa? (contoh: melamar kerja, pengajuan visa, daftar CPNS)',
        type: 'text',
        required: true,
      },
    ],
  },

  // ==================== PERIZINAN ====================
  {
    code: 'IKR',
    name: 'Izin Keramaian',
    description: 'Surat izin resmi untuk mengadakan acara atau kegiatan yang melibatkan banyak orang di wilayah kelurahan. Kegunaan: acara pernikahan/resepsi, acara ulang tahun besar, pengajian/acara keagamaan, acara komunitas, konser, bazar.',
    category: 'perizinan',
    requirements: [
      'KTP asli dan fotokopi penanggungjawab acara',
      'Surat Pengantar dari RT/RW',
      'Proposal acara (nama acara, tanggal, waktu, lokasi, jumlah tamu)',
      'Surat pernyataan kesanggupan menjaga ketertiban',
      'Denah lokasi acara',
      'Daftar panitia/penanggungjawab',
    ],
    sop_steps: [
      'Siapkan proposal acara lengkap',
      'Minta surat pengantar dari RT/RW',
      'Datang ke kantor kelurahan minimal 7 hari sebelum acara',
      'Isi formulir permohonan izin keramaian',
      'Serahkan berkas ke petugas',
      'Tunggu persetujuan Lurah',
      'Ambil surat izin keramaian',
    ],
    estimated_duration: 120,
    daily_quota: 10,
    citizen_questions: [
      {
        field: 'nama_acara',
        question: 'Apa nama acaranya?',
        type: 'text',
        required: true,
      },
      {
        field: 'jenis_acara',
        question: 'Jenis acaranya apa? (contoh: pernikahan, pengajian, sunatan, ulang tahun)',
        type: 'text',
        required: true,
      },
      {
        field: 'tanggal_acara',
        question: 'Kapan tanggal pelaksanaan acaranya?',
        type: 'text',
        required: true,
      },
      {
        field: 'lokasi_acara',
        question: 'Di mana lokasi acaranya?',
        type: 'text',
        required: true,
      },
      {
        field: 'jumlah_tamu',
        question: 'Perkiraan jumlah tamu yang hadir berapa orang?',
        type: 'text',
        required: true,
      },
    ],
  },

  // ==================== KEPENDUDUKAN ====================
  {
    code: 'SPKTP',
    name: 'Surat Pengantar KTP',
    description: 'Surat pengantar dari kelurahan untuk mengurus pembuatan atau perpanjangan KTP-el di Disdukcapil atau UPTD Kecamatan. Kegunaan: pembuatan KTP-el baru (usia 17 tahun), perpanjangan KTP-el, penggantian KTP-el hilang/rusak, perubahan data KTP-el.',
    category: 'kependudukan',
    requirements: [
      'Kartu Keluarga (KK) asli dan fotokopi',
      'Surat Pengantar dari RT/RW',
      'Pas foto 3x4 latar merah (4 lembar)',
      'KTP lama (jika perpanjangan/penggantian)',
      'Surat keterangan hilang dari Polisi (jika KTP hilang)',
    ],
    sop_steps: [
      'Minta surat pengantar dari RT/RW',
      'Datang ke kantor kelurahan dengan semua persyaratan',
      'Isi formulir permohonan',
      'Tunggu proses (15-30 menit)',
      'Ambil surat pengantar KTP',
      'Lanjutkan ke Disdukcapil/UPTD Kecamatan',
    ],
    estimated_duration: 30,
    daily_quota: 25,
    citizen_questions: [
      {
        field: 'jenis_pengurusan',
        question: 'Ini untuk KTP baru, perpanjangan, atau penggantian?',
        type: 'select',
        required: true,
        options: ['KTP Baru (usia 17 tahun)', 'Perpanjangan', 'Penggantian Hilang', 'Penggantian Rusak', 'Perubahan Data'],
      },
    ],
  },
  {
    code: 'SPKK',
    name: 'Surat Pengantar Kartu Keluarga',
    description: 'Surat pengantar dari kelurahan untuk mengurus pembuatan atau perubahan Kartu Keluarga di Disdukcapil. Kegunaan: pembuatan KK baru (keluarga baru), perubahan data KK (tambah/kurang anggota), penggantian KK hilang/rusak, pecah KK (pisah dari KK orang tua).',
    category: 'kependudukan',
    requirements: [
      'KK lama asli dan fotokopi (jika ada)',
      'KTP semua anggota keluarga (fotokopi)',
      'Surat Pengantar dari RT/RW',
      'Akta Nikah (untuk KK baru)',
      'Akta Kelahiran anak (jika tambah anggota)',
      'Akta Kematian (jika ada anggota meninggal)',
    ],
    sop_steps: [
      'Minta surat pengantar dari RT/RW',
      'Datang ke kantor kelurahan dengan semua persyaratan',
      'Isi formulir permohonan',
      'Tunggu proses verifikasi',
      'Ambil surat pengantar KK',
      'Lanjutkan ke Disdukcapil',
    ],
    estimated_duration: 30,
    daily_quota: 20,
    citizen_questions: [
      {
        field: 'jenis_pengurusan',
        question: 'Ini untuk KK baru, perubahan data, atau penggantian?',
        type: 'select',
        required: true,
        options: ['KK Baru (keluarga baru)', 'Perubahan Data', 'Pecah KK', 'Penggantian Hilang', 'Penggantian Rusak'],
      },
      {
        field: 'alasan_perubahan',
        question: 'Kalau perubahan/pecah KK, jelaskan alasannya? (contoh: tambah anak, pisah dari orang tua)',
        type: 'text',
        required: false,
      },
    ],
  },
  {
    code: 'SPSKCK',
    name: 'Surat Pengantar SKCK',
    description: 'Surat pengantar dari kelurahan untuk mengurus Surat Keterangan Catatan Kepolisian (SKCK) di kantor polisi. Kegunaan: syarat wajib untuk membuat SKCK di Polsek/Polres, melamar pekerjaan, pendaftaran CPNS/TNI/Polri, pengajuan visa.',
    category: 'kependudukan',
    requirements: [
      'KTP asli dan fotokopi (3 lembar)',
      'Kartu Keluarga (KK) fotokopi',
      'Surat Pengantar dari RT/RW',
      'Pas foto 4x6 latar merah (6 lembar)',
      'Akta Kelahiran (fotokopi)',
    ],
    sop_steps: [
      'Minta surat pengantar dari RT/RW',
      'Datang ke kantor kelurahan dengan semua persyaratan',
      'Isi formulir permohonan',
      'Tunggu proses (15-30 menit)',
      'Ambil surat pengantar SKCK',
      'Lanjutkan ke Polsek/Polres untuk membuat SKCK',
    ],
    estimated_duration: 30,
    daily_quota: 25,
    citizen_questions: [
      {
        field: 'keperluan',
        question: 'SKCK ini untuk keperluan apa? (contoh: melamar kerja, daftar CPNS, pengajuan visa)',
        type: 'text',
        required: true,
      },
    ],
  },
  {
    code: 'SPAKTA',
    name: 'Surat Pengantar Akta',
    description: 'Surat pengantar dari kelurahan untuk mengurus pembuatan Akta Kelahiran atau Akta Kematian di Disdukcapil. Kegunaan: pembuatan Akta Kelahiran, pembuatan Akta Kematian, perubahan data Akta.',
    category: 'kependudukan',
    requirements: [
      'Surat keterangan lahir dari RS/Bidan (untuk akta kelahiran)',
      'Surat keterangan kematian dari RS/Dokter (untuk akta kematian)',
      'KTP kedua orang tua/pelapor (fotokopi)',
      'KK orang tua (fotokopi)',
      'Akta Nikah orang tua (fotokopi, untuk akta kelahiran)',
      'Surat Pengantar dari RT/RW',
    ],
    sop_steps: [
      'Siapkan surat keterangan lahir/kematian dari RS/Bidan/Dokter',
      'Minta surat pengantar dari RT/RW',
      'Datang ke kantor kelurahan dengan semua persyaratan',
      'Isi formulir permohonan',
      'Tunggu proses verifikasi',
      'Ambil surat pengantar akta',
      'Lanjutkan ke Disdukcapil',
    ],
    estimated_duration: 30,
    daily_quota: 15,
    citizen_questions: [
      {
        field: 'jenis_akta',
        question: 'Ini untuk akta kelahiran atau akta kematian?',
        type: 'select',
        required: true,
        options: ['Akta Kelahiran', 'Akta Kematian'],
      },
      {
        field: 'nama_yang_bersangkutan',
        question: 'Siapa nama yang akan dibuatkan aktanya?',
        type: 'text',
        required: true,
      },
    ],
  },

  // ==================== SOSIAL ====================
  {
    code: 'SKK',
    name: 'Surat Keterangan Kematian',
    description: 'Surat keterangan dari kelurahan yang menyatakan bahwa seseorang telah meninggal dunia. Kegunaan: pengurusan Akta Kematian di Disdukcapil, klaim asuransi, pengurusan warisan, pencairan tabungan/deposito almarhum, pengurusan pensiun.',
    category: 'sosial',
    requirements: [
      'Surat keterangan kematian dari RS/Dokter/Bidan',
      'KTP almarhum asli',
      'KK asli',
      'KTP pelapor (keluarga)',
      'Surat Pengantar dari RT/RW',
    ],
    sop_steps: [
      'Dapatkan surat keterangan kematian dari RS/Dokter',
      'Minta surat pengantar dari RT/RW',
      'Datang ke kantor kelurahan dengan semua persyaratan',
      'Isi formulir permohonan',
      'Serahkan berkas ke petugas',
      'Tunggu proses verifikasi',
      'Ambil SKK yang sudah jadi',
    ],
    estimated_duration: 30,
    daily_quota: 10,
    citizen_questions: [
      {
        field: 'nama_almarhum',
        question: 'Siapa nama almarhum/almarhumah?',
        type: 'text',
        required: true,
      },
      {
        field: 'tanggal_meninggal',
        question: 'Kapan tanggal meninggalnya?',
        type: 'text',
        required: true,
      },
      {
        field: 'hubungan_pelapor',
        question: 'Kakak hubungannya apa dengan almarhum/almarhumah?',
        type: 'text',
        required: true,
      },
    ],
  },
  {
    code: 'SPP',
    name: 'Surat Pengantar Pindah',
    description: 'Surat dari kelurahan asal untuk warga yang akan pindah domisili ke kelurahan/kecamatan/kota lain. Kegunaan: pindah antar kelurahan dalam satu kecamatan, pindah antar kecamatan dalam satu kota, pindah antar kota/kabupaten, pindah antar provinsi.',
    category: 'kependudukan',
    requirements: [
      'KK asli dan fotokopi',
      'KTP semua anggota keluarga yang pindah (fotokopi)',
      'Surat Pengantar dari RT/RW alamat lama',
      'Surat keterangan tidak ada tunggakan dari RT/RW',
      'Alasan pindah',
    ],
    sop_steps: [
      'Minta surat pengantar dan keterangan bebas tunggakan dari RT/RW',
      'Datang ke kantor kelurahan dengan semua persyaratan',
      'Isi formulir permohonan pindah',
      'Serahkan berkas ke petugas',
      'Tunggu proses verifikasi',
      'Ambil surat pengantar pindah',
      'Lanjutkan ke Disdukcapil untuk Surat Pindah resmi',
    ],
    estimated_duration: 60,
    daily_quota: 10,
    citizen_questions: [
      {
        field: 'alamat_tujuan',
        question: 'Mau pindah ke alamat mana? (sebutkan kelurahan/kecamatan/kota tujuan)',
        type: 'text',
        required: true,
      },
      {
        field: 'jumlah_anggota_pindah',
        question: 'Berapa orang yang ikut pindah?',
        type: 'text',
        required: true,
      },
      {
        field: 'alasan_pindah',
        question: 'Alasan pindahnya apa? (contoh: pekerjaan, ikut keluarga, pendidikan)',
        type: 'text',
        required: true,
      },
    ],
  },
];

// Helper function untuk mendapatkan layanan berdasarkan kode
export function getServiceByCode(code: string): ServiceDefinition | undefined {
  return GOVERNMENT_SERVICES.find(s => s.code === code);
}

// Helper function untuk mendapatkan layanan berdasarkan kategori
export function getServicesByCategory(category: string): ServiceDefinition[] {
  return GOVERNMENT_SERVICES.filter(s => s.category === category);
}

// Helper function untuk mendapatkan semua pertanyaan untuk suatu layanan
export function getQuestionsForService(code: string): CitizenQuestion[] {
  const service = getServiceByCode(code);
  if (!service) return COMMON_CITIZEN_QUESTIONS;
  return [...COMMON_CITIZEN_QUESTIONS, ...service.citizen_questions];
}

// Default operating hours (sesuai KB-16-Info-Kelurahan.txt)
// Senin-Jumat: 08:00-15:00, Sabtu: 08:00-12:00, Minggu: TUTUP
// Jam istirahat: 12:00-13:00
export const DEFAULT_OPERATING_HOURS = {
  senin: { open: '08:00', close: '15:00', break_start: '12:00', break_end: '13:00' },
  selasa: { open: '08:00', close: '15:00', break_start: '12:00', break_end: '13:00' },
  rabu: { open: '08:00', close: '15:00', break_start: '12:00', break_end: '13:00' },
  kamis: { open: '08:00', close: '15:00', break_start: '12:00', break_end: '13:00' },
  jumat: { open: '08:00', close: '15:00', break_start: '12:00', break_end: '13:00' },
  sabtu: { open: '08:00', close: '12:00', break_start: null, break_end: null },
  minggu: null, // tutup
};

