import { NextRequest, NextResponse } from 'next/server'

const SESSION_ID_PATTERN = /^web_[a-z0-9_-]{8,128}$/i
const VILLAGE_ID_PATTERN = /^[a-z0-9_-]{8,64}$/i
const MAX_MESSAGE_LENGTH = 2000
const WINDOW_MS = 60_000
const MAX_REQUESTS = 30

const buckets = new Map<string, { count: number; resetAt: number }>()

function getClientIp(request: NextRequest): string {
  return request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
    request.headers.get('x-real-ip') ||
    'unknown'
}

export function validateWebchatSessionId(sessionId: string | null | undefined): string | null {
  const value = sessionId?.trim()
  return value && SESSION_ID_PATTERN.test(value) ? value : null
}

export function validateWebchatVillageId(villageId: string | null | undefined): string | null {
  const value = villageId?.trim()
  return value && VILLAGE_ID_PATTERN.test(value) ? value : null
}

export function normalizeWebchatMessage(message: unknown): string | null {
  if (typeof message !== 'string') return null
  const trimmed = message.trim()
  if (!trimmed || trimmed.length > MAX_MESSAGE_LENGTH) return null
  return trimmed
}

export function enforceWebchatRateLimit(request: NextRequest, sessionId: string, action: string): NextResponse | null {
  const now = Date.now()
  const key = `${action}:${getClientIp(request)}:${sessionId}`
  const bucket = buckets.get(key)

  if (!bucket || bucket.resetAt <= now) {
    buckets.set(key, { count: 1, resetAt: now + WINDOW_MS })
    return null
  }

  bucket.count += 1
  if (bucket.count > MAX_REQUESTS) {
    return NextResponse.json({ success: false, error: 'Too many requests' }, { status: 429 })
  }

  return null
}
