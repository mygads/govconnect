import { NextResponse } from 'next/server'
import { generateCsrfToken } from '@/lib/csrf'

/**
 * GET /api/csrf — Generate and return a CSRF token
 * Sets the token as a cookie and returns it in the response body
 */
export async function GET() {
  const { token, cookie } = generateCsrfToken()

  const response = NextResponse.json({ csrfToken: token })
  response.headers.set('Set-Cookie', cookie)
  return response
}
