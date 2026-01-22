import { NextRequest, NextResponse } from 'next/server'
import prisma from '@/lib/prisma'
import { verifyToken } from '@/lib/auth'

// In production, this would be stored in database
// For now, we store in environment variable via API
let adminSettings = {
  enabled: true,
  adminWhatsApp: process.env.ADMIN_WHATSAPP || '',
  soundEnabled: true,
  urgentCategories: [
    'bencana',
    'bencana_alam',
    'kebakaran',
    'kecelakaan',
    'keamanan',
    'kriminalitas',
    'kesehatan_darurat'
  ]
}

async function getSession(request: NextRequest) {
  const token = request.cookies.get('token')?.value ||
    request.headers.get('authorization')?.replace('Bearer ', '')

  if (!token) return null
  const payload = await verifyToken(token)
  if (!payload) return null

  const session = await prisma.admin_sessions.findUnique({
    where: { token },
    include: { admin: true }
  })

  if (!session || session.expires_at < new Date()) return null
  return session
}

export async function GET(request: NextRequest) {
  try {
    const session = await getSession(request)
    if (!session || session.admin.role !== 'superadmin') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    return NextResponse.json({
      success: true,
      data: adminSettings
    })
  } catch (error: any) {
    return NextResponse.json(
      { success: false, error: error.message },
      { status: 500 }
    )
  }
}

export async function POST(request: NextRequest) {
  try {
    const session = await getSession(request)
    if (!session || session.admin.role !== 'superadmin') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const body = await request.json()
    
    // Update settings
    adminSettings = {
      ...adminSettings,
      ...body
    }
    
    // In production, save to database here
    // Also update notification service config
    
    return NextResponse.json({
      success: true,
      message: 'Settings saved successfully',
      data: adminSettings
    })
  } catch (error: any) {
    return NextResponse.json(
      { success: false, error: error.message },
      { status: 500 }
    )
  }
}
