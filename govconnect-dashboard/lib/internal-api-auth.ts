import crypto from 'crypto'
import { NextRequest } from 'next/server'

function getConfiguredInternalApiKey(): string | null {
  const value = process.env['INTERNAL_API_KEY']?.trim()
  return value && value.length > 0 ? value : null
}

export function normalizeInternalApiKey(value: string | null): string | null {
  if (!value) return null

  let key = value.trim()
  if (key.toLowerCase().startsWith('bearer ')) {
    key = key.slice('bearer '.length).trim()
  }

  if (
    (key.startsWith('"') && key.endsWith('"')) ||
    (key.startsWith("'") && key.endsWith("'"))
  ) {
    key = key.slice(1, -1).trim()
  }

  return key.length > 0 ? key : null
}

export function getProvidedInternalApiKey(request: NextRequest): string | null {
  return (
    normalizeInternalApiKey(request.headers.get('x-internal-api-key')) ||
    normalizeInternalApiKey(request.headers.get('authorization'))
  )
}

export function isAuthorizedInternalRequest(request: NextRequest): boolean {
  const provided = getProvidedInternalApiKey(request)
  const expected = normalizeInternalApiKey(getConfiguredInternalApiKey())

  if (!provided || !expected) {
    return false
  }

  const providedBuf = Buffer.from(provided, 'utf8')
  const expectedBuf = Buffer.from(expected, 'utf8')

  if (providedBuf.length !== expectedBuf.length) {
    return false
  }

  return crypto.timingSafeEqual(providedBuf, expectedBuf)
}
