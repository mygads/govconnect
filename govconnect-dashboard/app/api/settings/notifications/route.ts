import { NextRequest, NextResponse } from 'next/server'
import prisma from '@/lib/prisma'
import { verifyToken } from '@/lib/auth'

// Notification settings - urgentCategories now comes from database (ComplaintType.is_urgent)
let adminSettings = {
  enabled: true,
  soundEnabled: true,
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

// Get urgent complaint types from Case Service API
async function getUrgentTypesFromDB(): Promise<string[]> {
  try {
    // Call Case Service API to get urgent types
    const caseServiceUrl = process.env.CASE_SERVICE_URL || 'http://case-service:3003'
    const res = await fetch(`${caseServiceUrl}/api/complaints/types?is_urgent=true`, {
      headers: {
        'x-api-key': process.env.INTERNAL_API_KEY || '',
      },
      cache: 'no-store',
    })
    if (res.ok) {
      const data = await res.json()
      const types = data.data || data || []
      return types.map((t: { name: string }) => t.name)
    }
    return []
  } catch {
    return []
  }
}

export async function GET(request: NextRequest) {
  try {
    const session = await getSession(request)
    if (!session || session.admin.role !== 'superadmin') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    // Fetch urgent categories from database
    const urgentCategories = await getUrgentTypesFromDB()

    return NextResponse.json({
      success: true,
      data: {
        ...adminSettings,
        urgentCategories, // From database, not hardcoded
      }
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
