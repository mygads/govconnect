import { PrismaClient } from '@prisma/client'
import bcrypt from 'bcryptjs'

const prisma = new PrismaClient({
  datasourceUrl: process.env.DATABASE_URL
})

async function main() {
  console.log('🌱 Seeding database for GovConnect Dashboard...\n')

  // Create default admin user for login
  console.log('Creating admin user...')

  const existingAdmin = await prisma.admin_users.findUnique({
    where: { username: 'admin' }
  })

  if (existingAdmin) {
    console.log('✅ Admin user already exists')
    console.log('   Username: admin')
    console.log('   (Password unchanged)\n')
  } else {
    const hashedPassword = await bcrypt.hash('admin123', 10)
    
    const admin = await prisma.admin_users.create({
      data: {
        username: 'admin',
        password_hash: hashedPassword,
        name: 'Administrator',
        role: 'superadmin',
        is_active: true
      }
    })

    console.log('✅ Admin user created successfully!')
    console.log('   Username: admin')
    console.log('   Password: admin123')
    console.log('   Role: superadmin\n')
  }

  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')
  console.log('✅ Database seeding completed!')
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')
  console.log('\n📝 Login Credentials:')
  console.log('   URL: http://localhost:3000')
  console.log('   Username: admin')
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
