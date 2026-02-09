/**
 * Superadmin API: Gemini BYOK Key - Individual Key Operations
 * PATCH /api/superadmin/gemini-keys/[id] - Update key
 * DELETE /api/superadmin/gemini-keys/[id] - Delete key
 */

import { NextRequest, NextResponse } from 'next/server'
import prisma from '@/lib/prisma'
import { verifyToken } from '@/lib/auth'

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
  return { session, payload }
}

function requireSuperadmin(payload: any) {
  return payload.role === 'superadmin'
}

/**
 * PATCH /api/superadmin/gemini-keys/[id]
 * Update key metadata: name, gmail_account, tier, is_active, priority
 */
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const result = await getSession(request)
    if (!result || !requireSuperadmin(result.payload)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const { id } = await params

    const existing = await prisma.gemini_api_keys.findUnique({
      where: { id },
    })
    if (!existing) {
      return NextResponse.json({ error: 'Key tidak ditemukan' }, { status: 404 })
    }

    const body = await request.json()
    const allowedFields = ['name', 'gmail_account', 'tier', 'is_active', 'is_valid', 'priority']
    const updateData: Record<string, any> = {}

    for (const field of allowedFields) {
      if (body[field] !== undefined) {
        updateData[field] = body[field]
      }
    }

    if (updateData.tier && !['free', 'tier1', 'tier2'].includes(updateData.tier)) {
      return NextResponse.json({ error: 'Tier harus free, tier1, atau tier2' }, { status: 400 })
    }

    // If reactivating (toggling is_active from false→true), also reset validity
    if (updateData.is_active === true && !existing.is_active) {
      updateData.consecutive_failures = 0
      updateData.is_valid = true
      updateData.invalid_reason = null
      updateData.last_error = null
    }

    // If re-validating (toggling is_valid from false→true), reset failure counters
    if (updateData.is_valid === true && !existing.is_valid) {
      updateData.consecutive_failures = 0
      updateData.invalid_reason = null
      updateData.last_error = null
    }

    const updated = await prisma.gemini_api_keys.update({
      where: { id },
      data: updateData,
    })

    return NextResponse.json({
      key: {
        ...updated,
        api_key: updated.api_key.substring(0, 8) + '...' + updated.api_key.substring(updated.api_key.length - 4),
      },
      message: 'API key berhasil diperbarui',
    })
  } catch (error) {
    console.error('Superadmin gemini-keys PATCH error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

/**
 * DELETE /api/superadmin/gemini-keys/[id]
 * Delete a key and its usage data.
 */
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const result = await getSession(request)
    if (!result || !requireSuperadmin(result.payload)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const { id } = await params
    const existing = await prisma.gemini_api_keys.findUnique({
      where: { id },
    })
    if (!existing) {
      return NextResponse.json({ error: 'Key tidak ditemukan' }, { status: 404 })
    }

    // Delete usage data first (FK constraint)
    await prisma.gemini_api_key_usage.deleteMany({
      where: { key_id: id },
    })

    // Delete the key
    await prisma.gemini_api_keys.delete({
      where: { id },
    })

    return NextResponse.json({
      message: `API key "${existing.name}" berhasil dihapus`,
    })
  } catch (error) {
    console.error('Superadmin gemini-keys DELETE error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
