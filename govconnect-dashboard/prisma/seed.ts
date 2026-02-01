import { PrismaClient } from '@prisma/client'
import bcrypt from 'bcryptjs'
import crypto from 'crypto'
import fs from 'fs'
import path from 'path'

const prisma = new PrismaClient({
  datasourceUrl: process.env.DATABASE_URL
})

function slugify(input: string): string {
  return (input || '')
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)+/g, '')
}

type SeedServiceDocItem = {
  name: string
  description: string | null
  requirements: string[]
  slug: string
}

function extractServicesFromDocument(docText: string): SeedServiceDocItem[] {
  const lines = (docText || '')
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0)

  const items: SeedServiceDocItem[] = []
  let currentName: string | null = null
  let currentRequirements: string[] = []

  const flush = () => {
    if (!currentName) return
    const requirements = currentRequirements
      .flatMap((r) => r.split(',').map((x) => x.trim()))
      .filter(Boolean)
      .map((r) => r.replace(/\s{2,}/g, ' '))

    const slug = slugify(currentName)
    items.push({
      name: currentName,
      description: null,
      requirements,
      slug,
    })

    currentName = null
    currentRequirements = []
  }

  for (const line of lines) {
    // Example: "1) Keterangan Domisili"
    const serviceMatch = line.match(/^\d+\)\s*(.+)$/)
    if (serviceMatch?.[1]) {
      flush()
      currentName = serviceMatch[1].trim()
      continue
    }

    // Example: "- KTP, KK, dan alamat lengkap."
    const reqMatch = line.match(/^-\s*(.+)$/)
    if (reqMatch?.[1] && currentName) {
      const raw = reqMatch[1]
        .replace(/\.$/, '')
        .replace(/\s+dan\s+/gi, ', ')
        .trim()
      currentRequirements.push(raw)
      continue
    }
  }

  flush()
  return items
}

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
    const passwordFromEnv = process.env.SUPERADMIN_PASSWORD?.trim()
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

  const seedFlag = (process.env.SEED_SANGRESENG_ADE || process.env.SEED_SANRESENG_ADE || '').toLowerCase()
  const shouldSeedSangresengAde = seedFlag === 'true'
  if (shouldSeedSangresengAde) {
    console.log('\n🌾 Seeding Desa Sanreseng Ade (dummy data)...')

    const villageName = 'Desa Sanreseng Ade'
    const villageSlug = 'desa-sanreseng-ade'
    const villageAdminUsername = (process.env.SANGRESENG_ADMIN_USERNAME || 'admin_sangreseng').trim()
    const villageAdminName = (process.env.SANGRESENG_ADMIN_NAME || 'Admin Desa Sanreseng Ade').trim()
    const villageAdminPassword = (process.env.SANGRESENG_ADMIN_PASSWORD || 'SangresengAde2026!').trim()

    const fixedVillageId = (process.env.DEFAULT_VILLAGE_ID || '').trim()

    const existingVillage = await prisma.villages.findUnique({
      where: { slug: villageSlug },
    })

    const village = existingVillage
      ? await prisma.villages.update({
          where: { id: existingVillage.id },
          data: { name: villageName, is_active: true },
        })
      : await prisma.villages.create({
          data: fixedVillageId
            ? { id: fixedVillageId, name: villageName, slug: villageSlug, is_active: true }
            : { name: villageName, slug: villageSlug, is_active: true },
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

    // ==================== SEED LAYANAN (dari dokumen panduan) ====================
    // Catatan arsitektur: Service Catalog utama berada di Case Service.
    // Dashboard menyimpan referensi/metadata (knowledge_base) agar bisa dipakai untuk RAG dan admin view.
    try {
      const docPath = path.resolve(
        __dirname,
        '../../docs/seed/desa-sangreseng-ade/documents/Panduan-Layanan-Administrasi-Desa-Sanreseng-Ade.txt'
      )
      if (fs.existsSync(docPath)) {
        const docText = fs.readFileSync(docPath, 'utf8')
        const servicesFromDoc = extractServicesFromDocument(docText)

        for (const s of servicesFromDoc) {
          const existing = await prisma.knowledge_base.findFirst({
            where: {
              village_id: village.id,
              category: 'layanan',
              title: s.name,
            },
          })

          const contentJson = JSON.stringify(
            {
              name: s.name,
              slug: s.slug,
              description: s.description,
              requirements: s.requirements,
            },
            null,
            2
          )

          const keywords = Array.from(
            new Set([
              'layanan',
              'administrasi',
              s.slug,
              ...s.name.toLowerCase().split(/\s+/).filter(Boolean),
              ...s.requirements.flatMap((r) => r.toLowerCase().split(/\s+/).filter(Boolean)),
            ])
          ).slice(0, 40)

          if (existing) {
            await prisma.knowledge_base.update({
              where: { id: existing.id },
              data: {
                content: contentJson,
                keywords,
                is_active: true,
                priority: 10,
              },
            })
          } else {
            await prisma.knowledge_base.create({
              data: {
                title: s.name,
                content: contentJson,
                category: 'layanan',
                village_id: village.id,
                keywords,
                is_active: true,
                priority: 10,
                admin_id: null,
              },
            })
          }
        }

        console.log(`✅ Seed layanan (knowledge_base) dari dokumen: ${servicesFromDoc.length} item`)
      } else {
        console.log('ℹ️ Dokumen panduan layanan tidak ditemukan, skip seeding layanan dari dokumen')
      }
    } catch (error: any) {
      console.log('⚠️ Gagal seed layanan dari dokumen (dashboard), lanjutkan proses seed lain')
      console.log(`   Reason: ${error?.message || error}`)
    }

    type ImportantContact = { name: string; phone: string; description: string }

    const importantCategories = [
      'Pelayanan',
      'Pengaduan',
      'Keamanan',
      'Polisi',
      'Kesehatan',
      'Kebakaran',
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
        { name: 'Danpos PA Asmar', phone: '6285399639869', description: 'Kontak keamanan (Danpos)' },
      ],
      Polisi: [
        { name: 'Polsek Bola', phone: '6282188118778', description: 'Kontak kepolisian (Polsek)' },
      ],
      Kesehatan: [
        { name: 'Puskesmas Solo A. Aswin PKM', phone: '6285363732235', description: 'Kontak kesehatan (Puskesmas)' },
      ],
      Kebakaran: [
        { name: 'DAMKAR Sektor Bola 001', phone: '6282192800935', description: 'Kontak pemadam kebakaran (Damkar)' },
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
  const dashboardPort = (process.env.DASHBOARD_PORT || '').trim() || '3000'
  console.log(`   URL: http://localhost:${dashboardPort}`)
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
