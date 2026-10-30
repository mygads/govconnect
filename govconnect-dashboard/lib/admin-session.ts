import { NextRequest } from 'next/server'
import { verifyToken } from '@/lib/auth'
import prisma from '@/lib/prisma'

export interface AdminSession {
  admin: {
    id: string
    username: string
    role: string
    village_id: string | null
  }
}

/**
 * Shared admin-session resolver for dashboard API routes.
 * Returns null when there is no valid session (caller → 401).
 */
export async function getAdminSession(request: NextRequest): Promise<AdminSession | null> {
  const token = request.cookies.get('token')?.value ||
    request.headers.get('authorization')?.replace('Bearer ', '')
  if (!token) return null
  const payload = await verifyToken(token)
  if (!payload) return null
  const session = await prisma.admin_sessions.findUnique({
    where: { token },
    include: { admin: true },
  })
  if (!session || session.expires_at < new Date()) return null
  return { admin: session.admin as AdminSession['admin'] }
}

/**
 * Village scope for KTP verification data: village admins are pinned to
 * their own village; superadmins pass ?village_id= explicitly.
 */
export function resolveVillageId(session: AdminSession, request: NextRequest): string | null {
  if (session.admin.village_id) return session.admin.village_id
  const q = new URL(request.url).searchParams.get('village_id')
  return q && q.trim() ? q.trim() : null
}
