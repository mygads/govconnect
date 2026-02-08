import { NextRequest, NextResponse } from 'next/server'
import prisma from '@/lib/prisma'
import { comparePassword, generateToken } from '@/lib/auth'

// Simple in-memory rate limiter for login attempts
const loginAttempts = new Map<string, { count: number; firstAttempt: number }>()
const RATE_LIMIT_WINDOW_MS = 15 * 60 * 1000 // 15 minutes
const MAX_ATTEMPTS = 10 // Max 10 attempts per window

function getClientIp(request: NextRequest): string {
  return request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
    request.headers.get('x-real-ip') ||
    'unknown'
}

function isRateLimited(ip: string): boolean {
  const now = Date.now()
  const entry = loginAttempts.get(ip)

  if (!entry) return false

  // Reset if window expired
  if (now - entry.firstAttempt > RATE_LIMIT_WINDOW_MS) {
    loginAttempts.delete(ip)
    return false
  }

  return entry.count >= MAX_ATTEMPTS
}

function recordAttempt(ip: string): void {
  const now = Date.now()
  const entry = loginAttempts.get(ip)

  if (!entry || now - entry.firstAttempt > RATE_LIMIT_WINDOW_MS) {
    loginAttempts.set(ip, { count: 1, firstAttempt: now })
  } else {
    entry.count++
  }
}

// Cleanup stale entries periodically (every 5 minutes)
setInterval(() => {
  const now = Date.now()
  for (const [ip, entry] of loginAttempts.entries()) {
    if (now - entry.firstAttempt > RATE_LIMIT_WINDOW_MS) {
      loginAttempts.delete(ip)
    }
  }
}, 5 * 60 * 1000)

export async function POST(request: NextRequest) {
  try {
    const clientIp = getClientIp(request)

    // Check rate limit
    if (isRateLimited(clientIp)) {
      return NextResponse.json(
        { error: 'Too many login attempts. Please try again later.' },
        { status: 429 }
      )
    }

    // Record the attempt
    recordAttempt(clientIp)

    const body = await request.json()
    // Trim whitespace from username (not password)
    const username = (body.username || '').trim()
    const password = body.password

    if (!username || !password) {
      return NextResponse.json(
        { error: 'Username and password are required' },
        { status: 400 }
      )
    }

    // Find admin user
    const admin = await prisma.admin_users.findUnique({
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
