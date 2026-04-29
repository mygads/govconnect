import { NextRequest, NextResponse } from 'next/server'
import { requireAuth } from '@/lib/auth'
import { prisma } from '@/lib/prisma'

export async function PATCH(request: NextRequest) {
  try {
    const [session, authError] = await requireAuth(request)
    if (authError) return authError

    const body = await request.json()
    const { name } = body

    if (!name || name.trim() === '') {
      return NextResponse.json({ error: 'Name is required' }, { status: 400 })
    }

    const updatedUser = await prisma.admin_users.update({
      where: { id: session.adminId },
      data: { name: name.trim() },
      select: {
        id: true,
        username: true,
        name: true,
        role: true,
      },
    })

    return NextResponse.json({
      message: 'Profile updated successfully',
      user: updatedUser,
    })
  } catch (error) {
    console.error('Error updating profile:', error)
    return NextResponse.json(
      { error: 'Failed to update profile' },
      { status: 500 }
    )
  }
}
