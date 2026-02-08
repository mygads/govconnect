import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { verifyToken } from './lib/auth'
import { isRouteAllowed, type AdminRole } from './lib/rbac'

const PUBLIC_PATHS = ['/login', '/form', '/api/public', '/api/webchat']
const AUTH_API_PATHS = ['/api/auth']
// Internal API paths that use x-internal-api-key instead of JWT
const INTERNAL_API_PATHS = ['/api/internal']

function isPublicPath(pathname: string) {
  return PUBLIC_PATHS.some((path) => pathname === path || pathname.startsWith(`${path}/`))
}

function isAuthApiPath(pathname: string) {
  return AUTH_API_PATHS.some((path) => pathname === path || pathname.startsWith(`${path}/`))
}

function isInternalApiPath(pathname: string) {
  return INTERNAL_API_PATHS.some((path) => pathname === path || pathname.startsWith(`${path}/`))
}

export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl

  // Skip auth check for public, auth, and internal API paths
  if (isPublicPath(pathname) || isAuthApiPath(pathname) || isInternalApiPath(pathname)) {
    return NextResponse.next()
  }

  const isDashboardRoute = pathname.startsWith('/dashboard')
  const isApiRoute = pathname.startsWith('/api')

  if (!isDashboardRoute && !isApiRoute) {
    return NextResponse.next()
  }

  const token = request.cookies.get('token')?.value || 
                request.headers.get('authorization')?.replace('Bearer ', '')

  if (!token) {
    if (isDashboardRoute) {
      return NextResponse.redirect(new URL('/login', request.url))
    }
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const payload = await verifyToken(token)
  if (!payload) {
    if (isDashboardRoute) {
      return NextResponse.redirect(new URL('/login', request.url))
    }
    return NextResponse.json({ error: 'Invalid token' }, { status: 401 })
  }

  if (isDashboardRoute) {
    const role = payload.role as AdminRole
    if (!isRouteAllowed(role, pathname)) {
      return NextResponse.redirect(new URL('/dashboard', request.url))
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
