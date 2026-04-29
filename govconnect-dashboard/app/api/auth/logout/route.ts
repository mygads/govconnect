import { NextRequest, NextResponse } from 'next/server'
import prisma from '@/lib/prisma'
import { verifyCsrf } from '@/lib/csrf'

export async function POST(request: NextRequest) {
  try {
    const csrfError = verifyCsrf(request)
    if (csrfError) return csrfError

    const token = request.cookies.get('token')?.value

    if (token) {
      // Delete session from database
      await prisma.admin_sessions.deleteMany({
        where: { token }
      })
    }

    const response = NextResponse.json({ success: true })
    
    // Clear cookie
    response.cookies.delete('token')

    return response
  } catch (error) {
    console.error('Logout error:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}
