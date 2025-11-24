import { PrismaClient } from '@prisma/client'
import bcrypt from 'bcryptjs'

const prisma = new PrismaClient({
  datasourceUrl: process.env.DATABASE_URL
})

async function main() {
  console.log('Seeding admin user...')

  // Check if admin already exists
  const existingAdmin = await prisma.adminUsers.findUnique({
    where: { username: 'admin' }
  })

  if (existingAdmin) {
    console.log('✅ Admin user already exists, skipping seed')
    return
  }

  // Generate ID manually (simple cuid-like)
  const id = `adm_${Date.now()}_${Math.random().toString(36).substring(7)}`

  // Create default admin user
  const hashedPassword = await bcrypt.hash('admin123', 10)
  
  const admin = await prisma.adminUsers.create({
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

main()
  .then(async () => {
    await prisma.$disconnect()
  })
  .catch(async (e) => {
    console.error('Error seeding database:', e)
    await prisma.$disconnect()
    process.exit(1)
  })
