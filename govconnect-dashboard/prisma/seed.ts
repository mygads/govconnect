import { PrismaClient } from '@prisma/client'
import bcrypt from 'bcryptjs'
import crypto from 'crypto'

const prisma = new PrismaClient({
  datasourceUrl: process.env.DATABASE_URL
})

async function main() {
  console.log('🌱 Seeding database for GovConnect Dashboard...\n')

  // Create superadmin user for login
  console.log('Creating superadmin user...')

  const username = (process.env.SUPERADMIN_USERNAME || 'superadmin').trim()
  const name = (process.env.SUPERADMIN_NAME || 'Super Admin').trim()

  const existingSuperadmin = await prisma.admin_users.findUnique({
    where: { username }
  })

  if (existingSuperadmin) {
    console.log('✅ Superadmin user already exists')
    console.log(`   Username: ${username}`)
    console.log('   (Password unchanged)\n')
  } else {
    const passwordFromEnv = (process.env.SUPERADMIN_PASSWORD?.trim() || '1234abcd')
    const generatedPassword = crypto.randomBytes(12).toString('base64url')
    const plainPassword = passwordFromEnv && passwordFromEnv.length > 0 ? passwordFromEnv : generatedPassword

    const hashedPassword = await bcrypt.hash(plainPassword, 10)

    await prisma.admin_users.create({
      data: {
        username,
        password_hash: hashedPassword,
        name,
        role: 'superadmin',
        is_active: true,
        village_id: null,
      }
    })

    console.log('✅ Superadmin user created successfully!')
    console.log(`   Username: ${username}`)
    if (passwordFromEnv && passwordFromEnv.length > 0) {
      console.log('   Password: (set via SUPERADMIN_PASSWORD env)')
    } else {
      console.log(`   Password: ${plainPassword}`)
      console.log('   (Auto-generated. Save this password now.)')
    }
    console.log('   Role: superadmin\n')
  }

  const shouldSeedSangresengAde = (process.env.SEED_SANRESENG_ADE || '').toLowerCase() === 'true'
  if (shouldSeedSangresengAde) {
    console.log('\n🌾 Seeding Desa Sanreseng Ade (dummy data)...')

    const villageName = 'Desa Sanreseng Ade'
    const villageSlug = 'desa-sanreseng-ade'
    const villageAdminUsername = (process.env.SANGRESENG_ADMIN_USERNAME || 'admin_sangreseng').trim()
    const villageAdminName = (process.env.SANGRESENG_ADMIN_NAME || 'Admin Desa Sanreseng Ade').trim()
    const villageAdminPassword = (process.env.SANGRESENG_ADMIN_PASSWORD || 'SangresengAde2026!').trim()

    const village = await prisma.villages.upsert({
      where: { slug: villageSlug },
      update: { name: villageName, is_active: true },
      create: { name: villageName, slug: villageSlug, is_active: true },
    })

    const existingVillageAdmin = await prisma.admin_users.findUnique({
      where: { username: villageAdminUsername },
    })

    if (!existingVillageAdmin) {
      const hashedPassword = await bcrypt.hash(villageAdminPassword, 10)
      await prisma.admin_users.create({
        data: {
          username: villageAdminUsername,
          password_hash: hashedPassword,
          name: villageAdminName,
          role: 'village_admin',
          is_active: true,
          village_id: village.id,
        },
      })
    }

    const existingProfile = await prisma.village_profiles.findFirst({
      where: { village_id: village.id },
    })

    if (existingProfile) {
      await prisma.village_profiles.update({
        where: { id: existingProfile.id },
        data: {
          name: villageName,
          address: 'Dusun Pusat, Desa Sanreseng Ade, Kec. Panca Rijang, Kab. Sidenreng Rappang, Sulawesi Selatan',
          gmaps_url: 'https://maps.google.com/?q=Desa+Sanreseng+Ade',
          short_name: 'sanreseng-ade',
          operating_hours: {
            senin: { open: '08:00', close: '15:30' },
            selasa: { open: '08:00', close: '15:30' },
            rabu: { open: '08:00', close: '15:30' },
            kamis: { open: '08:00', close: '15:30' },
            jumat: { open: '08:00', close: '11:30' },
            sabtu: { open: '08:00', close: '12:00' },
            minggu: { open: null, close: null },
          },
        },
      })
    } else {
      await prisma.village_profiles.create({
        data: {
          village_id: village.id,
          name: villageName,
          address: 'Dusun Pusat, Desa Sanreseng Ade, Kec. Panca Rijang, Kab. Sidenreng Rappang, Sulawesi Selatan',
          gmaps_url: 'https://maps.google.com/?q=Desa+Sanreseng+Ade',
          short_name: 'sanreseng-ade',
          operating_hours: {
            senin: { open: '08:00', close: '15:30' },
            selasa: { open: '08:00', close: '15:30' },
            rabu: { open: '08:00', close: '15:30' },
            kamis: { open: '08:00', close: '15:30' },
            jumat: { open: '08:00', close: '11:30' },
            sabtu: { open: '08:00', close: '12:00' },
            minggu: { open: null, close: null },
          },
        },
      })
    }

    const defaultCategories = [
      'Profil Desa',
      'FAQ',
      'Struktur Desa',
      'Data RT/RW',
      'Layanan Administrasi',
      'Panduan/SOP',
      'Custom',
    ]

    await prisma.knowledge_categories.createMany({
      data: defaultCategories.map((name) => ({
        village_id: village.id,
        name,
        is_default: true,
      })),
      skipDuplicates: true,
    })

    const categoryMap = new Map<string, string>()
    const categories = await prisma.knowledge_categories.findMany({
      where: { village_id: village.id },
    })
    categories.forEach((category) => categoryMap.set(category.name, category.id))

    // Basis pengetahuan tidak di-seed jika dokumen sudah tersedia.

    type ImportantContact = { name: string; phone: string; description: string }

    const importantCategories = [
      'Pelayanan',
      'Pengaduan',
      'Keamanan',
      'Kesehatan',
      'Pemadam',
    ] as const

    type ImportantCategoryName = (typeof importantCategories)[number]

    const contactsByCategory: Record<ImportantCategoryName, ImportantContact[]> = {
      Pelayanan: [
        { name: 'Kecamatan Bola', phone: '+62 852-5582-9256', description: 'Nomor pelayanan kecamatan' },
        { name: 'Kelurahan Solo', phone: '+62 853-3295-0944', description: 'Nomor pelayanan kelurahan' },
        { name: 'Desa Pasir Putih', phone: '+62 821-2999-5145', description: 'Nomor pelayanan desa' },
        { name: 'Desa Pattanga', phone: '+62 822-6181-5145', description: 'Nomor pelayanan desa' },
        { name: 'Desa Sanreseng Ade', phone: '+62 821-3400-9525', description: 'Nomor pelayanan desa' },
        { name: 'Desa Lattimu', phone: '+62 853-4972-3275', description: 'Nomor pelayanan desa' },
        { name: 'Desa Ujung Tanah', phone: '+62 821-2424-1303', description: 'Nomor pelayanan desa' },
        { name: 'Desa Rajamawellang', phone: '+62 813-5353-2832', description: 'Nomor pelayanan desa' },
        { name: 'Desa Bola', phone: '+62 823-3545-1792', description: 'Nomor pelayanan desa' },
        { name: 'Desa Lempong', phone: '+62 853-9423-4648', description: 'Nomor pelayanan desa' },
        { name: 'Desa Balielo', phone: '+62 823-4645-4449', description: 'Nomor pelayanan desa' },
        { name: 'Desa Manurung', phone: '+62 821-9364-5087', description: 'Nomor pelayanan desa' },
      ],
      Pengaduan: [
        { name: 'Kecamatan Bola', phone: '+62 852-4061-9726', description: 'Nomor pengaduan kecamatan' },
        { name: 'Admin Desa Sanreseng Ade', phone: '+62 819-3088-1342', description: 'Admin pengaduan desa' },
      ],
      Keamanan: [
        { name: 'Polsek Bola', phone: '+62 821-8811-8778', description: 'Layanan keamanan Polsek' },
        { name: 'Danpos Bola', phone: '+62 853-9963-9869', description: 'Layanan keamanan Danpos' },
      ],
      Kesehatan: [
        { name: 'Puskesmas Solo', phone: '+62 853-6373-2235', description: 'Layanan kesehatan puskesmas' },
      ],
      Pemadam: [
        { name: 'DAMKAR Sektor Bola', phone: '+62 821-9280-0935', description: 'Pemadam kebakaran sektor bola' },
      ],
    }

    for (const categoryName of importantCategories) {
      const category = await prisma.important_contact_categories.upsert({
        where: { id: `${village.slug}-${categoryName.toLowerCase().replace(/\s+/g, '-')}` },
        update: { name: categoryName, village_id: village.id },
        create: { id: `${village.slug}-${categoryName.toLowerCase().replace(/\s+/g, '-')}`, name: categoryName, village_id: village.id },
      })

      const contacts = contactsByCategory[categoryName]

      for (const contact of contacts) {
        await prisma.important_contacts.upsert({
          where: { id: `${category.id}-${contact.name.toLowerCase().replace(/\s+/g, '-')}` },
          update: {
            name: contact.name,
            phone: contact.phone,
            description: contact.description,
            category_id: category.id,
          },
          create: {
            id: `${category.id}-${contact.name.toLowerCase().replace(/\s+/g, '-')}`,
            name: contact.name,
            phone: contact.phone,
            description: contact.description,
            category_id: category.id,
          },
        })
      }
    }

    console.log('✅ Desa Sanreseng Ade dummy data seeded')
    console.log(`   Village ID: ${village.id}`)
    console.log(`   Admin Username: ${villageAdminUsername}`)
    console.log(`   Admin Password: ${villageAdminPassword}`)
  }

  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')
  console.log('✅ Database seeding completed!')
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')
  console.log('\n📝 Login:')
  console.log('   URL: http://localhost:3000')
  console.log(`   Username: ${username}`)
  console.log('   Password: (lihat output di atas / env SUPERADMIN_PASSWORD)')
  console.log('\n⚠️  IMPORTANT: Ganti kata sandi setelah login pertama!\n')
}

main()
  .then(async () => {
    await prisma.$disconnect()
  })
  .catch(async (e) => {
    console.error('❌ Error seeding database:', e)
    await prisma.$disconnect()
    process.exit(1)
  })
