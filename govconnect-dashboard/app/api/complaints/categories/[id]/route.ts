import { NextRequest, NextResponse } from 'next/server'
import { verifyToken } from '@/lib/auth'
import prisma from '@/lib/prisma'
import { buildUrl, ServicePath, getHeaders, apiFetch } from '@/lib/api-client'

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

export async function PATCH(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    const session = await getSession(request)
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { id } = await context.params

    const body = await request.json()
    const { name, description } = body
    if (!name) {
      return NextResponse.json({ error: 'name is required' }, { status: 400 })
    }

    const response = await apiFetch(buildUrl(ServicePath.CASE, `/complaints/categories/${id}`), {
      method: 'PATCH',
      headers: getHeaders(),
      body: JSON.stringify({ name, description: description || null }),
    })

    const data = await response.json().catch(() => ({}))
    if (!response.ok) {
      return NextResponse.json({ error: data.error || 'Failed to update category' }, { status: response.status })
    }

    return NextResponse.json(data)
  } catch (error) {
    console.error('Error updating complaint category:', error)
    return NextResponse.json({ error: 'Failed to update category' }, { status: 500 })
  }
}

export async function DELETE(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    const session = await getSession(request)
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { id } = await context.params

    const response = await apiFetch(buildUrl(ServicePath.CASE, `/complaints/categories/${id}`), {
      method: 'DELETE',
      headers: getHeaders(),
    })

    const data = await response.json().catch(() => ({}))
    if (!response.ok) {
      return NextResponse.json({ error: data.error || 'Failed to delete category' }, { status: response.status })
    }

    return NextResponse.json(data)
  } catch (error) {
    console.error('Error deleting complaint category:', error)
    return NextResponse.json({ error: 'Failed to delete category' }, { status: 500 })
  }
}