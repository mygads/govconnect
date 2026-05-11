import { SignJWT, jwtVerify } from 'jose'
import bcrypt from 'bcryptjs'
import { NextRequest, NextResponse } from 'next/server'
import prisma from '@/lib/prisma'

// Lazy initialization to avoid build-time errors
// JWT_SECRET is checked at runtime when first used, not at build time
let _jwtSecret: Uint8Array | null = null

function getJwtSecret(): Uint8Array {
  if (_jwtSecret) return _jwtSecret
  
  const jwtSecretValue = process.env.JWT_SECRET
  if (!jwtSecretValue && process.env.NODE_ENV === 'production') {
    throw new Error('JWT_SECRET environment variable is required in production')
  }
  _jwtSecret = new TextEncoder().encode(
    jwtSecretValue || 'dev-only-secret-do-not-use-in-production'
  )
  return _jwtSecret
}

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

export function normalizeAdminRole(role?: string | null): string | null {
  if (!role) return role ?? null
  const normalized = role.toLowerCase()
  return normalized === 'superadmin' || normalized === 'super_admin' ? 'superadmin' : role
}

export function isSuperadminRole(role?: string | null): boolean {
  return normalizeAdminRole(role) === 'superadmin'
}

export async function generateToken(payload: JWTPayload): Promise<string> {
  return await new SignJWT({ ...payload, role: normalizeAdminRole(payload.role) ?? payload.role })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime('24h')
    .sign(getJwtSecret())
}

export async function verifyToken(token: string): Promise<JWTPayload | null> {
  try {
    const { payload } = await jwtVerify(token, getJwtSecret())
    const verifiedPayload = payload as unknown as JWTPayload
    return {
      ...verifiedPayload,
      role: normalizeAdminRole(verifiedPayload.role) ?? verifiedPayload.role,
    }
  } catch (error) {
    return null
  }
}

export async function getAuthUser(request: NextRequest): Promise<JWTPayload | null> {
  const authHeader = request.headers.get('authorization')
  if (!authHeader) {
    return null
  }

  const token = authHeader.replace('Bearer ', '')
  return await verifyToken(token)
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
      include: {
        admin: {
          include: { village: true },
        },
      }
    })

    if (!session || session.expires_at < new Date() || !session.admin.is_active) return null
    if (session.admin.village_id && !session.admin.village?.is_active) return null

    return {
      id: session.id,
      adminId: session.admin.id,
      username: session.admin.username,
      name: session.admin.name,
      role: normalizeAdminRole(session.admin.role) ?? session.admin.role,
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

// ── Fase 2: Server-side RBAC helpers ──

export type AdminRole = 'superadmin' | 'village_admin' | 'admin'

/**
 * Require authentication. Returns session or sends 401 response.
 * Usage in API route:
 *   const [session, errorResponse] = await requireAuth(request)
 *   if (errorResponse) return errorResponse
 */
export async function requireAuth(
  request: NextRequest,
): Promise<[AdminSession, null] | [null, NextResponse]> {
  const session = await getAdminSession(request)
  if (!session) {
    return [null, NextResponse.json({ error: 'Unauthorized' }, { status: 401 })]
  }
  return [session, null]
}

/**
 * Require specific role(s). Returns session or sends 403 response.
 * Usage:
 *   const [session, errorResponse] = await requireRole(request, 'superadmin')
 *   if (errorResponse) return errorResponse
 */
export async function requireRole(
  request: NextRequest,
  ...roles: AdminRole[]
): Promise<[AdminSession, null] | [null, NextResponse]> {
  const [session, authError] = await requireAuth(request)
  if (authError) return [null, authError]

  if (!roles.includes(session!.role as AdminRole)) {
    return [null, NextResponse.json(
      { error: 'Forbidden: insufficient permissions' },
      { status: 403 },
    )]
  }
  return [session!, null]
}
