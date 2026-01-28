import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

function slugify(input: string): string {
  return input
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)+/g, '');
}

const SERVICE_SEEDS = [
  {
    category: 'Administrasi Kependudukan',
    name: 'Surat Pengantar KTP',
    description: 'Pengantar pembuatan/perubahan KTP-el di Disdukcapil.',
    requirements: [
      { label: 'Kartu Keluarga', field_type: 'file' },
      { label: 'Surat Pengantar RT/RW', field_type: 'file' },
      { label: 'KTP Lama (jika ada)', field_type: 'file', is_required: false },
      { label: 'Nomor HP Pemohon', field_type: 'text' },
    ],
  },
  {
    category: 'Administrasi Kependudukan',
    name: 'Surat Pengantar Pindah',
    description: 'Surat pengantar pindah domisili.',
    requirements: [
      { label: 'KTP', field_type: 'file' },
      { label: 'Kartu Keluarga (KK)', field_type: 'file' },
      { label: 'Data Alamat Tujuan Pindah', field_type: 'textarea' },
    ],
  },
  {
    category: 'Administrasi Kependudukan',
    name: 'Surat Keterangan Kelahiran',
    description: 'Surat keterangan kelahiran untuk pengurusan akta.',
    requirements: [
      { label: 'Kartu Keluarga', field_type: 'file' },
      { label: 'Nama Bayi', field_type: 'text' },
      { label: 'Surat Keterangan Lahir (bidan/RS)', field_type: 'file', is_required: false },
    ],
  },
  {
    category: 'Administrasi Kependudukan',
    name: 'Surat Keterangan Kematian',
    description: 'Surat keterangan kematian warga.',
    requirements: [
      { label: 'KTP yang meninggal', field_type: 'file' },
      { label: 'KTP Saksi Keluarga', field_type: 'file' },
      { label: 'Data Waktu & Lokasi Meninggal', field_type: 'textarea' },
    ],
  },
  {
    category: 'Administrasi Kependudukan',
    name: 'Surat Pengantar Nikah',
    description: 'Surat pengantar nikah dari desa.',
    requirements: [
      { label: 'KTP', field_type: 'file' },
      { label: 'Kartu Keluarga (KK)', field_type: 'file' },
      { label: 'Surat Pengantar RT/RW', field_type: 'file' },
      { label: 'Nama Calon Pasangan', field_type: 'text' },
    ],
  },
  {
    category: 'Administrasi Kependudukan',
    name: 'Surat Keterangan Belum Menikah',
    description: 'Surat keterangan status belum menikah.',
    requirements: [
      { label: 'KTP yang bersangkutan', field_type: 'file' },
      { label: 'KTP Saksi', field_type: 'file' },
      { label: 'Kartu Keluarga (KK)', field_type: 'file' },
      { label: 'Saksi: Imam dan Tokoh Masyarakat', field_type: 'text' },
      { label: 'Surat Pengantar RT/RW', field_type: 'file' },
    ],
  },
  {
    category: 'Administrasi Kependudukan',
    name: 'Surat Beda Nama',
    description: 'Surat keterangan beda nama untuk data ganda.',
    requirements: [
      { label: 'KTP', field_type: 'file' },
      { label: 'Data Pendukung Beda Nama', field_type: 'file' },
      { label: 'Surat Pengantar RT/RW', field_type: 'file' },
      { label: 'Kronologi Singkat', field_type: 'textarea' },
    ],
  },
  {
    category: 'Administrasi Kependudukan',
    name: 'Keterangan Domisili',
    description: 'Surat keterangan domisili warga.',
    requirements: [
      { label: 'KTP', field_type: 'file' },
      { label: 'Kartu Keluarga (KK)', field_type: 'file' },
      { label: 'Alamat Lengkap', field_type: 'textarea' },
    ],
  },
  {
    category: 'Administrasi Kependudukan',
    name: 'Keterangan Usaha',
    description: 'Surat keterangan usaha dari desa.',
    requirements: [
      { label: 'KTP', field_type: 'file' },
      { label: 'Foto Usaha', field_type: 'file' },
      { label: 'Nama Usaha', field_type: 'text' },
      { label: 'Alamat Usaha', field_type: 'textarea' },
    ],
  },
  {
    category: 'Administrasi Kependudukan',
    name: 'Keterangan Tidak Mampu',
    description: 'Surat keterangan tidak mampu untuk bantuan sosial/pendidikan.',
    requirements: [
      { label: 'KTP', field_type: 'file' },
      { label: 'Kartu Keluarga (KK)', field_type: 'file' },
      { label: 'Terdaftar di DTKS (opsional)', field_type: 'file', is_required: false },
      { label: 'Surat Pengantar RT/RW', field_type: 'file' },
      { label: 'Keperluan SKTM', field_type: 'textarea' },
    ],
  },
  {
    category: 'Administrasi Kependudukan',
    name: 'Rekomendasi BBM',
    description: 'Rekomendasi BBM untuk kelompok tani terdaftar.',
    requirements: [
      { label: 'Berita Acara Kelompok Tani (KT) Terdaftar', field_type: 'file' },
      { label: 'KTP', field_type: 'file' },
      { label: 'Persetujuan Penyuluh', field_type: 'file' },
    ],
  },
  {
    category: 'Administrasi Kependudukan',
    name: 'Pengantar Ternak',
    description: 'Surat pengantar ternak dari desa.',
    requirements: [
      { label: 'Foto Ternak', field_type: 'file' },
      { label: 'Kartu Keluarga', field_type: 'file' },
      { label: 'Alamat Tujuan', field_type: 'textarea' },
      { label: 'Alasan Pindah', field_type: 'textarea' },
    ],
  },
  {
    category: 'Pertanahan & Perizinan',
    name: 'Keterangan Kepemilikan Tanah BRI',
    description: 'Surat keterangan kepemilikan tanah untuk keperluan BRI.',
    requirements: [
      { label: 'KTP Pemohon', field_type: 'file' },
      { label: 'SPPT', field_type: 'file' },
      { label: 'KTP sesuai nama pada SPPT', field_type: 'file' },
      { label: 'Kartu Keluarga', field_type: 'file' },
      { label: 'Bukti Kepemilikan (SPPT/Sertifikat)', field_type: 'file' },
      { label: 'Luas & Lokasi Tanah', field_type: 'textarea' },
    ],
  },
  {
    category: 'Administrasi Kependudukan',
    name: 'Kartu Identitas Anak (KIA)',
    description: 'Layanan KIA di desa/kecamatan sesuai ketentuan usia.',
    requirements: [
      { label: 'Kartu Keluarga (KK)', field_type: 'file' },
      { label: 'Akta Kelahiran', field_type: 'file' },
      { label: 'Foto Anak (usia > 5 tahun)', field_type: 'file', is_required: false },
      { label: 'Tahun Kelahiran (ganjil/genap)', field_type: 'text' },
    ],
  },
  {
    category: 'Kependudukan Kecamatan',
    name: 'Kartu Keluarga (Penambahan Anggota Baru Lahir)',
    description: 'Persyaratan KK untuk anggota baru lahir.',
    requirements: [
      { label: 'Formulir F1-02', field_type: 'file' },
      { label: 'Formulir F1-01', field_type: 'file' },
      { label: 'KK Lama', field_type: 'file' },
      { label: 'SPTJM Data Lahir', field_type: 'file' },
    ],
  },
  {
    category: 'Kependudukan Kecamatan',
    name: 'Pergantian Kartu Keluarga Baru',
    description: 'Pergantian KK karena hilang/rusak/Barcode.',
    requirements: [
      { label: 'Formulir F1-02', field_type: 'file' },
      { label: 'Surat Kehilangan (jika hilang)', field_type: 'file', is_required: false },
      { label: 'KK Lama (jika rusak/Barcode)', field_type: 'file', is_required: false },
    ],
  },
  {
    category: 'Kependudukan Kecamatan',
    name: 'Perekaman KTP',
    description: 'Perekaman/perubahan KTP di kecamatan.',
    requirements: [
      { label: 'Fotokopi Kartu Keluarga (KK)', field_type: 'file' },
      { label: 'KTP Lama (jika pergantian)', field_type: 'file', is_required: false },
    ],
  },
  {
    category: 'Kependudukan Kecamatan',
    name: 'Akta Lahir',
    description: 'Pengurusan akta lahir.',
    requirements: [
      { label: 'Kartu Keluarga (KK)', field_type: 'file' },
      { label: 'SPTJM Data Lahir', field_type: 'file' },
      { label: 'Formulir F2-01', field_type: 'file' },
      { label: 'Buku Pink (jika ada)', field_type: 'file', is_required: false },
      { label: 'KTP Orang Tua', field_type: 'file' },
      { label: 'Buku Nikah Orang Tua', field_type: 'file' },
      { label: 'KTP Saksi Kelahiran', field_type: 'file' },
    ],
  },
  {
    category: 'Kependudukan Kecamatan',
    name: 'Pindah Keluar',
    description: 'Pengurusan pindah keluar (SKPWNI).',
    requirements: [
      { label: 'Surat Pengantar Pindah dari Desa', field_type: 'file' },
      { label: 'Nomor SKPWNI', field_type: 'text' },
    ],
  },
  {
    category: 'Kependudukan Kecamatan',
    name: 'Pindah Masuk',
    description: 'Pengurusan pindah masuk (SKPWNI dari daerah asal).',
    requirements: [
      { label: 'SKPWNI dari daerah asal', field_type: 'file' },
      { label: 'Catatan Pindah', field_type: 'textarea', is_required: false },
    ],
  },
  {
    category: 'Dukcapil',
    name: 'Kartu Identitas Anak (KIA) Dukcapil',
    description: 'Pengurusan KIA di dukcapil.',
    requirements: [
      { label: 'Kartu Keluarga (KK)', field_type: 'file' },
      { label: 'Akta Kelahiran', field_type: 'file' },
      { label: 'Foto Anak (usia > 5 tahun)', field_type: 'file', is_required: false },
      { label: 'Tahun Kelahiran (ganjil/genap)', field_type: 'text' },
    ],
  },
  {
    category: 'Dukcapil',
    name: 'Pergantian KTP Rusak',
    description: 'Pergantian KTP jika rusak.',
    requirements: [
      { label: 'KTP Lama', field_type: 'file' },
      { label: 'Kartu Keluarga (KK)', field_type: 'file' },
    ],
  },
  {
    category: 'Dukcapil',
    name: 'Pergantian KTP Hilang',
    description: 'Pergantian KTP jika hilang.',
    requirements: [
      { label: 'Surat Keterangan Kehilangan', field_type: 'file' },
      { label: 'Kartu Keluarga (KK)', field_type: 'file' },
    ],
  },
  {
    category: 'Akta Jual Beli',
    name: 'Pengantar Akta Jual Beli / Pengoperan Hak (Desa)',
    description: 'Pengantar AJB tingkat desa.',
    requirements: [
      { label: 'Fotokopi KTP Penjual & Pembeli', field_type: 'file' },
      { label: 'SPPT Terbaru', field_type: 'file' },
      { label: 'Kwitansi Transaksi', field_type: 'file' },
      { label: 'Fotokopi KTP Saksi', field_type: 'file' },
      { label: 'Data Tanah (batas-batas tanah)', field_type: 'textarea' },
    ],
  },
  {
    category: 'Akta Jual Beli',
    name: 'Pengoperan Hak (Kecamatan)',
    description: 'Pengoperan hak di tingkat kecamatan.',
    requirements: [
      { label: 'Surat Pengantar dari Desa', field_type: 'file' },
      { label: 'Fotokopi KTP Penjual & Pembeli', field_type: 'file' },
      { label: 'Fotokopi KTP Saksi', field_type: 'file' },
      { label: 'SPPT Terbaru', field_type: 'file' },
    ],
  },
  {
    category: 'Akta Jual Beli',
    name: 'Akta Jual Beli (Kecamatan)',
    description: 'AJB di tingkat kecamatan.',
    requirements: [
      { label: 'Surat Pengantar dari Desa', field_type: 'file' },
      { label: 'Fotokopi KTP Penjual & Pembeli', field_type: 'file' },
      { label: 'SPPT Terbaru', field_type: 'file' },
      { label: 'Fotokopi KTP Saksi', field_type: 'file' },
      { label: 'Sertifikat Tanah Asli', field_type: 'file' },
    ],
  },
  {
    category: 'Kelompok Tani',
    name: 'Proposal Bantuan Kelompok Tani',
    description: 'Pengajuan proposal bantuan kelompok tani.',
    requirements: [
      { label: 'Sampul Proposal', field_type: 'file' },
      { label: 'Halaman Pengesahan', field_type: 'file' },
      { label: 'Kata Pengantar/Pendahuluan (opsional)', field_type: 'file', is_required: false },
      { label: 'Daftar Nama Anggota + Luas Lahan', field_type: 'file' },
      { label: 'Berita Acara Pembentukan Kelompok', field_type: 'file' },
      { label: 'Akta Pengukuhan Kelompok', field_type: 'file' },
      { label: 'Fotokopi KTP Ketua & Bendahara', field_type: 'file' },
      { label: 'Surat Persetujuan Tetangga (bantuan bor)', field_type: 'file', is_required: false },
      { label: 'Surat Terdaftar di SIMHULTAN', field_type: 'file' },
    ],
  },
  {
    category: 'Kelompok Tani',
    name: 'Alur Proposal Kelompok Tani (Informasi)',
    description: 'Alur pengurusan proposal kelompok tani.',
    requirements: [
      { label: 'Berkas Proposal Lengkap', field_type: 'file' },
      { label: 'Tanda Tangan Ketua Kelompok Tani', field_type: 'file' },
      { label: 'Tanda Tangan Penyuluh Pertanian', field_type: 'file' },
      { label: 'Tanda Tangan Kepala Desa', field_type: 'file' },
      { label: 'Verifikasi Kecamatan (Pertanian)', field_type: 'file' },
      { label: 'Tanda Tangan Camat', field_type: 'file' },
      { label: 'Pengajuan ke Dinas Pertanian', field_type: 'file' },
    ],
  },
];

const COMPLAINT_SEEDS = [
  {
    category: 'Infrastruktur & Utilitas',
    description: 'Masalah infrastruktur desa dan utilitas umum.',
    types: [
      { name: 'Jalan Rusak', is_urgent: true, require_address: true, send_important_contacts: true, important_contact_category: 'Darurat' },
      { name: 'Lampu Jalan Mati', is_urgent: false, require_address: true, send_important_contacts: false },
      { name: 'Jembatan Rusak', is_urgent: true, require_address: true, send_important_contacts: true, important_contact_category: 'Darurat' },
      { name: 'Drainase Tersumbat', is_urgent: false, require_address: true, send_important_contacts: false },
    ],
  },
  {
    category: 'Lingkungan',
    description: 'Kebersihan dan lingkungan sekitar.',
    types: [
      { name: 'Sampah Menumpuk', is_urgent: false, require_address: true, send_important_contacts: false },
      { name: 'Pohon Tumbang', is_urgent: true, require_address: true, send_important_contacts: true, important_contact_category: 'Darurat' },
      { name: 'Banjir Lokal', is_urgent: true, require_address: true, send_important_contacts: true, important_contact_category: 'Darurat' },
    ],
  },
  {
    category: 'Kesehatan & Sosial',
    description: 'Masalah kesehatan masyarakat dan bantuan sosial.',
    types: [
      { name: 'Butuh Ambulans', is_urgent: true, require_address: true, send_important_contacts: true, important_contact_category: 'Kesehatan' },
      { name: 'Bantuan Sosial', is_urgent: false, require_address: false, send_important_contacts: false },
      { name: 'Kejadian Gawat Darurat', is_urgent: true, require_address: true, send_important_contacts: true, important_contact_category: 'Kesehatan' },
    ],
  },
  {
    category: 'Keamanan',
    description: 'Keamanan dan ketertiban umum.',
    types: [
      { name: 'Pencurian', is_urgent: true, require_address: true, send_important_contacts: true, important_contact_category: 'Keamanan' },
      { name: 'Keributan', is_urgent: true, require_address: true, send_important_contacts: true, important_contact_category: 'Keamanan' },
      { name: 'Laporan Orang Hilang', is_urgent: true, require_address: true, send_important_contacts: true, important_contact_category: 'Keamanan' },
    ],
  },
  {
    category: 'Layanan Publik',
    description: 'Masalah pelayanan umum desa.',
    types: [
      { name: 'Pelayanan Lambat', is_urgent: false, require_address: false, send_important_contacts: false },
      { name: 'Aduan Administrasi', is_urgent: false, require_address: false, send_important_contacts: false },
    ],
  },
];

async function main() {
  const villageId = (process.env.VILLAGE_ID || process.env.DEFAULT_VILLAGE_ID || '').trim();
  if (!villageId) {
    throw new Error('VILLAGE_ID atau DEFAULT_VILLAGE_ID wajib di-set untuk seed Desa Sanreseng Ade');
  }

  console.log('🌱 Seeding Case Service data for Desa Sanreseng Ade...');

  const categoryIdByName = new Map<string, string>();
  for (const categoryName of Array.from(new Set(SERVICE_SEEDS.map((s) => s.category)))) {
    const category = await prisma.serviceCategory.upsert({
      where: { id: `${villageId}-${slugify(categoryName)}` },
      update: {
        village_id: villageId,
        name: categoryName,
        description: `Kategori layanan: ${categoryName}`,
        is_active: true,
      },
      create: {
        id: `${villageId}-${slugify(categoryName)}`,
        village_id: villageId,
        name: categoryName,
        description: `Kategori layanan: ${categoryName}`,
        is_active: true,
      },
    });

    categoryIdByName.set(categoryName, category.id);
  }

  for (const service of SERVICE_SEEDS) {
    const categoryId = categoryIdByName.get(service.category);
    if (!categoryId) continue;

    const slug = slugify(`${service.category}-${service.name}`);
    const serviceItem = await prisma.serviceItem.upsert({
      where: { slug },
      update: {
        village_id: villageId,
        category_id: categoryId,
        name: service.name,
        description: service.description,
        mode: 'both',
        is_active: true,
      },
      create: {
        village_id: villageId,
        category_id: categoryId,
        name: service.name,
        description: service.description,
        slug,
        mode: 'both',
        is_active: true,
      },
    });

    for (let index = 0; index < service.requirements.length; index++) {
      const requirement = service.requirements[index];
      const existing = await prisma.serviceRequirement.findFirst({
        where: { service_id: serviceItem.id, label: requirement.label },
      });

      if (!existing) {
        await prisma.serviceRequirement.create({
          data: {
            service_id: serviceItem.id,
            label: requirement.label,
            field_type: requirement.field_type,
            is_required: requirement.is_required ?? true,
            order_index: index,
          },
        });
      }
    }
  }

  for (const category of COMPLAINT_SEEDS) {
    const complaintCategory = await prisma.complaintCategory.upsert({
      where: { id: `${villageId}-${slugify(category.category)}` },
      update: {
        village_id: villageId,
        name: category.category,
        description: category.description,
        is_active: true,
      },
      create: {
        id: `${villageId}-${slugify(category.category)}`,
        village_id: villageId,
        name: category.category,
        description: category.description,
        is_active: true,
      },
    });

    for (const type of category.types) {
      const typeKey = `${complaintCategory.id}-${slugify(type.name)}`;
      await prisma.complaintType.upsert({
        where: { id: typeKey },
        update: {
          category_id: complaintCategory.id,
          name: type.name,
          description: type.description ?? null,
          is_urgent: type.is_urgent,
          require_address: type.require_address,
          send_important_contacts: type.send_important_contacts ?? false,
          important_contact_category: type.important_contact_category ?? null,
        },
        create: {
          id: typeKey,
          category_id: complaintCategory.id,
          name: type.name,
          description: type.description ?? null,
          is_urgent: type.is_urgent,
          require_address: type.require_address,
          send_important_contacts: type.send_important_contacts ?? false,
          important_contact_category: type.important_contact_category ?? null,
        },
      });
    }
  }

  console.log('✅ Case Service dummy data seeded');
}

main()
  .then(async () => {
    await prisma.$disconnect();
  })
  .catch(async (error) => {
    console.error('❌ Error seeding case service:', error);
    await prisma.$disconnect();
    process.exit(1);
  });
