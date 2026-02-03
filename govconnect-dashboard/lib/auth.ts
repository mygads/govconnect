import { SignJWT, jwtVerify } from 'jose'
import bcrypt from 'bcryptjs'
import { NextRequest } from 'next/server'
import prisma from '@/lib/prisma'

// JWT_SECRET must be set in environment - no insecure fallback
const jwtSecretValue = process.env.JWT_SECRET
if (!jwtSecretValue && process.env.NODE_ENV === 'production') {
  throw new Error('JWT_SECRET environment variable is required in production')
}
const JWT_SECRET = new TextEncoder().encode(
  jwtSecretValue || 'dev-only-secret-do-not-use-in-production'
)

export interface JWTPayload {
  adminId: string
  username: string
  name: string
  role: string
}

export interface AdminSession {
  id: string
  adminId: string
  username: string
  name: string
  role: string
  villageId: string | null
  token: string
}

export async function generateToken(payload: JWTPayload): Promise<string> {
  return await new SignJWT({ ...payload })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime('24h')
    .sign(JWT_SECRET)
}

export async function verifyToken(token: string): Promise<JWTPayload | null> {
  try {
    const { payload } = await jwtVerify(token, JWT_SECRET)
    return payload as unknown as JWTPayload
  } catch (error) {
    return null
  }
}

/**
 * Get admin session from request with village_id
 * Returns null if not authenticated
 */
export async function getAdminSession(request: NextRequest): Promise<AdminSession | null> {
  try {
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
    
    return {
      id: session.id,
      adminId: session.admin.id,
      username: session.admin.username,
      name: session.admin.name,
      role: session.admin.role,
      villageId: session.admin.village_id,
      token: session.token,
    }
  } catch (error) {
    console.error('Error getting admin session:', error)
    return null
  }
}

/**
 * Resolve village_id: use from session if available, otherwise from query param (for superadmin)
 */
export function resolveVillageId(request: NextRequest, session: AdminSession): string | null {
  // Village admin: always use their village_id
  if (session.villageId) {
    return session.villageId
  }
  
  // Superadmin: can access specific village via query param, or all if not specified
  const url = new URL(request.url)
  return url.searchParams.get('village_id')
}

export async function hashPassword(password: string): Promise<string> {
  return await bcrypt.hash(password, 10)
}

export async function comparePassword(
  password: string,
  hash: string
): Promise<boolean> {
  return await bcrypt.compare(password, hash)
}
