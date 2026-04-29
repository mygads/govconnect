import { NextRequest, NextResponse } from 'next/server'
import { requireAuth } from '@/lib/auth'

export async function GET(request: NextRequest) {
  try {
    const [session, authError] = await requireAuth(request)
    if (authError) return authError

    return NextResponse.json({
      user: {
        id: session.adminId,
        username: session.username,
        name: session.name,
        role: session.role,
        village_id: session.villageId,
      }
    })
  } catch (error) {
    console.error('Auth check error:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}
