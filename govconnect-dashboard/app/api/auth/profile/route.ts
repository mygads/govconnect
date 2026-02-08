import { NextRequest, NextResponse } from 'next/server'
import { getAuthUser } from '@/lib/auth'
import { prisma } from '@/lib/prisma'

export async function PATCH(request: NextRequest) {
  try {
    const payload = await getAuthUser(request)
    if (!payload) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const body = await request.json()
    const { name } = body

    if (!name || name.trim() === '') {
      return NextResponse.json({ error: 'Name is required' }, { status: 400 })
    }

    const updatedUser = await prisma.admin_users.update({
      where: { id: payload.adminId },
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
