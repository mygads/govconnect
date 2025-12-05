import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { verifyToken } from './lib/auth'

export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl

  // Public paths yang tidak perlu auth
  if (pathname === '/login' || pathname.startsWith('/api/auth/login')) {
    return NextResponse.next()
  }

  // Check token untuk protected routes
  const token = request.cookies.get('token')?.value || 
                request.headers.get('authorization')?.replace('Bearer ', '')

  if (!token && pathname.startsWith('/dashboard')) {
    return NextResponse.redirect(new URL('/login', request.url))
  }

  if (token) {
    const payload = await verifyToken(token)
    if (!payload && pathname.startsWith('/dashboard')) {
      return NextResponse.redirect(new URL('/login', request.url))
    }
  }

  return NextResponse.next()
}

export const config = {
  matcher: [
    '/dashboard/:path*', 
    '/login',
    // Match API routes EXCEPT file upload routes
    // This prevents "Response body object should not be disturbed or locked" error
    '/api/((?!documents|upload).*)',
  ]
}
