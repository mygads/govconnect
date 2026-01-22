import { PrismaClient } from '@prisma/client'
import bcrypt from 'bcryptjs'

const prisma = new PrismaClient({
  datasourceUrl: process.env.DATABASE_URL
})

async function main() {
  console.log('🌱 Seeding database for GovConnect Dashboard...\n')

  // Create default super admin user
  console.log('Creating super admin user...')

  const existingAdmin = await prisma.users.findUnique({
    where: { email: 'admin@govconnect.id' }
  })

  if (existingAdmin) {
    console.log('✅ Super admin user already exists')
    console.log('   Email: admin@govconnect.id')
    console.log('   (Password unchanged)\n')
  } else {
    const hashedPassword = await bcrypt.hash('admin123', 10)
    
    await prisma.users.create({
      data: {
        email: 'admin@govconnect.id',
        password_hash: hashedPassword,
        name: 'Super Administrator',
        role: 'SUPER_ADMIN',
        is_active: true
      }
    })

    console.log('✅ Super admin user created successfully!')
    console.log('   Email: admin@govconnect.id')
    console.log('   Password: admin123')
    console.log('   Role: SUPER_ADMIN\n')
  }

  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')
  console.log('✅ Database seeding completed!')
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')
  console.log('\n📝 Login Credentials:')
  console.log('   URL: http://localhost:3000')
  console.log('   Email: admin@govconnect.id')
  console.log('   Password: admin123')
  console.log('\n⚠️  IMPORTANT: Change password after first login!\n')
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
