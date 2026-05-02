/**
 * Webchat Clear Session API
 * POST /api/webchat/clear-session
 * Clears AI caches/profile for a webchat session so user starts fresh.
 */

import { NextRequest, NextResponse } from 'next/server';
import { buildUrl, getInternalApiKey, ServicePath } from '@/lib/api-client';

const WEBCHAT_SESSION_ID_PATTERN = /^(webchat|wc|session)[:_-]?[a-zA-Z0-9._:-]{8,120}$/;

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { sessionId } = body;

    if (typeof sessionId !== 'string' || !WEBCHAT_SESSION_ID_PATTERN.test(sessionId.trim())) {
      return NextResponse.json(
        { success: false, error: 'sessionId tidak valid' },
        { status: 400 }
      );
    }

    const normalizedSessionId = sessionId.trim();

    // Call AI Service to clear user caches and profile
    const clearUrl = buildUrl(ServicePath.AI, '/admin/cache/clear-user');

    const response = await fetch(clearUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-internal-api-key': getInternalApiKey(),
      },
      body: JSON.stringify({ userId: normalizedSessionId }),
    });

    if (!response.ok) {
      console.error('Failed to clear AI cache', { status: response.status });
      return NextResponse.json(
        { success: false, error: 'Failed to clear webchat session', code: 'UPSTREAM_UNAVAILABLE' },
        { status: 503 },
      );
    }

    return NextResponse.json({ success: true });
  } catch (error: any) {
    console.error('Clear session error:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to clear webchat session', code: 'UPSTREAM_UNAVAILABLE' },
      { status: 503 },
    );
  }
}
