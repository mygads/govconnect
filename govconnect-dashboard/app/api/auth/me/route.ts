import { NextRequest, NextResponse } from 'next/server'
import { verifyUserToken } from '@/lib/auth'
import prisma from '@/lib/prisma'

export async function GET(request: NextRequest) {
  try {
    const token = request.cookies.get('token')?.value ||
                 request.headers.get('authorization')?.replace('Bearer ', '')

    if (!token) {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 }
      )
    }

    const payload = await verifyUserToken(token)
    if (!payload) {
      return NextResponse.json(
        { error: 'Token tidak valid' },
        { status: 401 }
      )
    }

    // Verify session exists and not expired
    const session = await prisma.user_sessions.findUnique({
      where: { token },
      include: { 
        user: {
          include: {
            village: true
          }
        }
      }
    })

    if (!session || session.expires_at < new Date()) {
      return NextResponse.json(
        { error: 'Sesi telah berakhir' },
        { status: 401 }
      )
    }

    return NextResponse.json({
      success: true,
      user: {
        id: session.user.id,
        email: session.user.email,
        name: session.user.name,
        role: session.user.role,
        phone: session.user.phone,
        avatar_url: session.user.avatar_url,
        village: session.user.village ? {
          id: session.user.village.id,
          name: session.user.village.name,
          short_name: session.user.village.short_name
        } : null
      }
    })
  } catch (error) {
    console.error('Auth check error:', error)
    return NextResponse.json(
      { error: 'Terjadi kesalahan server' },
      { status: 500 }
    )
  }
}
