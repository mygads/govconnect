/**
 * CSRF Protection for Dashboard API (Fase 3.7)
 * 
 * Double Submit Cookie pattern:
 * 1. Server sets a random CSRF token in a cookie
 * 2. Client sends the same token in X-CSRF-Token header
 * 3. Server verifies they match
 * 
 * Usage in API routes:
 *   import { verifyCsrf } from '@/lib/csrf'
 *   const csrfError = verifyCsrf(request)
 *   if (csrfError) return csrfError
 */

import { NextRequest, NextResponse } from 'next/server'
import crypto from 'crypto'

const CSRF_COOKIE_NAME = '__gc_csrf'
const CSRF_HEADER_NAME = 'x-csrf-token'
const CSRF_TOKEN_LENGTH = 32

/**
 * Generate a CSRF token and set it as a cookie
 */
export function generateCsrfToken(): { token: string; cookie: string } {
  const token = crypto.randomBytes(CSRF_TOKEN_LENGTH).toString('hex')
  const secure = process.env.NODE_ENV === 'production' ? '; Secure' : ''
  const cookie = `${CSRF_COOKIE_NAME}=${token}; Path=/; HttpOnly; SameSite=Strict${secure}`
  return { token, cookie }
}

/**
 * Verify CSRF token from request.
 * Returns null if valid, NextResponse error if invalid.
 * Skips verification for:
 * - GET/HEAD/OPTIONS requests (safe methods)
 * - Requests with x-internal-api-key (service-to-service)
 */
export function verifyCsrf(request: NextRequest): NextResponse | null {
  // Safe methods don't need CSRF
  const method = request.method.toUpperCase()
  if (['GET', 'HEAD', 'OPTIONS'].includes(method)) {
    return null
  }

  // Internal service calls are exempt
  if (request.headers.get('x-internal-api-key') || request.headers.get('x-service-token')) {
    return null
  }

  const cookieToken = request.cookies.get(CSRF_COOKIE_NAME)?.value
  const headerToken = request.headers.get(CSRF_HEADER_NAME)

  if (!cookieToken || !headerToken) {
    return NextResponse.json(
      { error: 'CSRF token missing' },
      { status: 403 }
    )
  }

  // Timing-safe comparison
  try {
    const cookieBuf = Buffer.from(cookieToken)
    const headerBuf = Buffer.from(headerToken)
    if (cookieBuf.length !== headerBuf.length || !crypto.timingSafeEqual(cookieBuf, headerBuf)) {
      return NextResponse.json(
        { error: 'CSRF token mismatch' },
        { status: 403 }
      )
    }
  } catch {
    return NextResponse.json(
      { error: 'CSRF token invalid' },
      { status: 403 }
    )
  }

  return null // Valid
}
