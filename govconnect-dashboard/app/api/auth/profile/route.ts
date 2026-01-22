import { NextRequest, NextResponse } from 'next/server'
import { verifyUserToken } from '@/lib/auth'
import prisma from '@/lib/prisma'

export async function PATCH(request: NextRequest) {
  try {
    const token = request.cookies.get('token')?.value ||
                 request.headers.get('authorization')?.replace('Bearer ', '')
    
    if (!token) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const payload = await verifyUserToken(token)
    if (!payload) {
      return NextResponse.json({ error: 'Token tidak valid' }, { status: 401 })
    }

    const body = await request.json()
    const { name, phone } = body

    if (!name || name.trim() === '') {
      return NextResponse.json({ error: 'Nama harus diisi' }, { status: 400 })
    }

    const updatedUser = await prisma.users.update({
      where: { id: payload.userId },
      data: { 
        name: name.trim(),
        ...(phone !== undefined && { phone })
      },
      select: {
        id: true,
        email: true,
        name: true,
        role: true,
        phone: true,
        avatar_url: true,
      },
    })

    return NextResponse.json({
      success: true,
      message: 'Profil berhasil diperbarui',
      user: updatedUser,
    })
  } catch (error) {
    console.error('Error updating profile:', error)
    return NextResponse.json(
      { error: 'Gagal memperbarui profil' },
      { status: 500 }
    )
  }
}
