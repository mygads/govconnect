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
