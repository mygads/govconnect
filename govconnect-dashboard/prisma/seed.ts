import { PrismaClient } from '@prisma/client'
import bcrypt from 'bcryptjs'

const prisma = new PrismaClient({
  datasourceUrl: process.env.DATABASE_URL
})

async function main() {
  console.log('Seeding admin user...')

  // Check if admin already exists
  const existingAdmin = await prisma.admin_users.findUnique({
    where: { username: 'admin' }
  })

  if (existingAdmin) {
    console.log('✅ Admin user already exists, skipping seed')
  } else {
    // Generate ID manually (simple cuid-like)
    const id = `adm_${Date.now()}_${Math.random().toString(36).substring(7)}`

    // Create default admin user
    const hashedPassword = await bcrypt.hash('admin123', 10)
    
    const admin = await prisma.admin_users.create({
      data: {
        id,
        username: 'admin',
        password_hash: hashedPassword,
        name: 'Administrator',
        role: 'superadmin',
        is_active: true
      }
    })

    console.log('✅ Created admin user:', {
      username: admin.username,
      name: admin.name,
      role: admin.role
    })

    console.log('\n📝 Default credentials:')
    console.log('   Username: admin')
    console.log('   Password: admin123')
    console.log('\n⚠️  PLEASE CHANGE PASSWORD AFTER FIRST LOGIN!\n')
  }

  // Seed default system settings
  console.log('\nSeeding system settings...')
  
  const defaultSettings = [
    { key: 'ai_chatbot_enabled', value: 'true', description: 'Enable/disable AI chatbot feature' },
    { key: 'ai_model_primary', value: 'gemini-2.5-flash', description: 'Primary AI model' },
    { key: 'ai_model_fallback', value: 'gemini-2.0-flash', description: 'Fallback AI model if primary fails' },
  ]

  for (const setting of defaultSettings) {
    await prisma.system_settings.upsert({
      where: { key: setting.key },
      update: {},
      create: setting,
    })
  }

  console.log('✅ System settings seeded')

  // Seed sample knowledge base entries
  console.log('\nSeeding sample knowledge base...')

  const sampleKnowledge = [
    {
      title: 'Jam Operasional Kantor Kelurahan',
      content: 'Kantor Kelurahan buka pada hari Senin - Jumat, pukul 08:00 - 16:00 WIB. Istirahat pukul 12:00 - 13:00 WIB. Pada hari Sabtu, Minggu, dan hari libur nasional, kantor tutup.',
      category: 'jadwal',
      keywords: ['jam', 'buka', 'tutup', 'operasional', 'jadwal', 'kerja'],
      priority: 10,
    },
    {
      title: 'Alamat Kantor Kelurahan',
      content: 'Kantor Kelurahan beralamat di Jl. Pemerintahan No. 1, Kelurahan Contoh, Kecamatan Demo, Kota Sampel. Telepon: (021) 123-4567. Email: kelurahan@demo.go.id',
      category: 'kontak',
      keywords: ['alamat', 'lokasi', 'dimana', 'telepon', 'email', 'kontak'],
      priority: 10,
    },
    {
      title: 'Syarat Pembuatan Surat Keterangan Domisili',
      content: 'Syarat pembuatan Surat Keterangan Domisili:\n1. Fotokopi KTP (1 lembar)\n2. Fotokopi Kartu Keluarga (1 lembar)\n3. Pas foto 3x4 (2 lembar)\n4. Surat pengantar dari RT/RW\n5. Mengisi formulir permohonan\n\nWaktu proses: 1-2 hari kerja\nBiaya: Gratis',
      category: 'prosedur',
      keywords: ['syarat', 'domisili', 'surat', 'keterangan', 'persyaratan', 'dokumen'],
      priority: 8,
    },
    {
      title: 'Syarat Pembuatan Surat Pengantar',
      content: 'Syarat pembuatan Surat Pengantar:\n1. Fotokopi KTP\n2. Fotokopi KK\n3. Surat pengantar dari RT/RW\n4. Dokumen pendukung sesuai keperluan\n\nWaktu proses: Langsung jadi\nBiaya: Gratis',
      category: 'prosedur',
      keywords: ['syarat', 'pengantar', 'surat', 'persyaratan'],
      priority: 8,
    },
    {
      title: 'Layanan yang Tersedia',
      content: 'Layanan yang tersedia di Kelurahan:\n1. Surat Keterangan Domisili\n2. Surat Pengantar\n3. Legalisir Dokumen\n4. Surat Keterangan Tidak Mampu\n5. Surat Keterangan Usaha\n6. Izin Keramaian\n7. Pengaduan Masyarakat\n\nSemua layanan dasar tidak dipungut biaya.',
      category: 'layanan',
      keywords: ['layanan', 'tersedia', 'apa', 'saja', 'jenis', 'macam'],
      priority: 9,
    },
    {
      title: 'Cara Melaporkan Masalah',
      content: 'Cara melaporkan masalah infrastruktur:\n1. Jelaskan jenis masalah (jalan rusak, lampu mati, sampah, dll)\n2. Sebutkan lokasi/alamat lengkap\n3. Bisa lampirkan foto jika ada\n\nLaporan akan diproses maksimal 3x24 jam. Anda akan mendapat nomor laporan untuk tracking.',
      category: 'faq',
      keywords: ['lapor', 'cara', 'masalah', 'aduan', 'pengaduan'],
      priority: 7,
    },
  ]

  for (const knowledge of sampleKnowledge) {
    const existing = await prisma.knowledge_base.findFirst({
      where: { title: knowledge.title }
    })

    if (!existing) {
      await prisma.knowledge_base.create({
        data: knowledge,
      })
    }
  }

  console.log('✅ Sample knowledge base seeded')
}

main()
  .then(async () => {
    await prisma.$disconnect()
  })
  .catch(async (e) => {
    console.error('Error seeding database:', e)
    await prisma.$disconnect()
    process.exit(1)
  })
