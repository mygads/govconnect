import { NextRequest, NextResponse } from 'next/server'
import prisma from '@/lib/prisma'
import { comparePassword, generateUserToken } from '@/lib/auth'

export async function POST(request: NextRequest) {
  try {
    const { email, password } = await request.json()

    if (!email || !password) {
      return NextResponse.json(
        { error: 'Email dan password harus diisi' },
        { status: 400 }
      )
    }

    // Find user
    const user = await prisma.users.findUnique({
      where: { email },
      include: {
        village: true
      }
    })

    if (!user || !user.is_active) {
      return NextResponse.json(
        { error: 'Email atau password salah' },
        { status: 401 }
      )
    }

    // Verify password
    const isValid = await comparePassword(password, user.password_hash)
    if (!isValid) {
      return NextResponse.json(
        { error: 'Email atau password salah' },
        { status: 401 }
      )
    }

    // Generate JWT token
    const token = await generateUserToken({
      userId: user.id,
      email: user.email,
      name: user.name,
      role: user.role,
      villageId: user.village?.id,
      villageShortName: user.village?.short_name
    })

    // Create session
    const expiresAt = new Date()
    expiresAt.setHours(expiresAt.getHours() + 24)

    await prisma.user_sessions.create({
      data: {
        user_id: user.id,
        token,
        expires_at: expiresAt,
        ip_address: request.headers.get('x-forwarded-for') || 
                   request.headers.get('x-real-ip') || 
                   'unknown',
        user_agent: request.headers.get('user-agent') || 'unknown'
      }
    })

    // Log activity
    await prisma.activity_logs.create({
      data: {
        user_id: user.id,
        action: 'LOGIN',
        resource: 'auth',
        details: { email: user.email },
        ip_address: request.headers.get('x-forwarded-for') || 
                   request.headers.get('x-real-ip') || 
                   'unknown'
      }
    })

    const response = NextResponse.json({
      success: true,
      token,
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        role: user.role,
        village: user.village ? {
          id: user.village.id,
          name: user.village.name,
          short_name: user.village.short_name
        } : null
      }
    })

    // Set cookie
    response.cookies.set('token', token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: 60 * 60 * 24 // 24 hours
    })

    return response
  } catch (error) {
    console.error('Login error:', error)
    return NextResponse.json(
      { error: 'Terjadi kesalahan server' },
      { status: 500 }
    )
  }
}
