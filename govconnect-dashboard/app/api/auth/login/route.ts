import { NextRequest, NextResponse } from 'next/server'
import prisma from '@/lib/prisma'
import { comparePassword, generateToken } from '@/lib/auth'

export async function POST(request: NextRequest) {
  try {
    const { username, password } = await request.json()

    if (!username || !password) {
      return NextResponse.json(
        { error: 'Username and password are required' },
        { status: 400 }
      )
    }

    // Find admin user
    const admin = await prisma.adminUsers.findUnique({
      where: { username }
    })

    if (!admin || !admin.is_active) {
      return NextResponse.json(
        { error: 'Invalid credentials' },
        { status: 401 }
      )
    }

    // Verify password
    const isValid = await comparePassword(password, admin.password_hash)
    if (!isValid) {
      return NextResponse.json(
        { error: 'Invalid credentials' },
        { status: 401 }
      )
    }

    // Generate JWT token
    const token = await generateToken({
      adminId: admin.id,
      username: admin.username,
      name: admin.name,
      role: admin.role
    })

    // Create session
    const expiresAt = new Date()
    expiresAt.setHours(expiresAt.getHours() + 24)

    await prisma.admin_sessions.create({
      data: {
        admin_id: admin.id,
        token,
        expires_at: expiresAt
      }
    })

    // Log activity
    await prisma.activity_logs.create({
      data: {
        admin_id: admin.id,
        action: 'login',
        resource: 'auth',
        details: { username: admin.username },
        ip_address: request.headers.get('x-forwarded-for') || 
                   request.headers.get('x-real-ip') || 
                   'unknown'
      }
    })

    const response = NextResponse.json({
      success: true,
      token,
      user: {
        id: admin.id,
        username: admin.username,
        name: admin.name,
        role: admin.role
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
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}
