/**
 * Webchat Clear Session API
 * POST /api/webchat/clear-session
 * Clears AI caches/profile for a webchat session so user starts fresh.
 */

import { NextRequest, NextResponse } from 'next/server';
import { buildUrl, getInternalApiKey, ServicePath } from '@/lib/api-client';
import { enforceWebchatRateLimit, validateWebchatSessionId } from '@/lib/webchat-guard';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const normalizedSessionId = validateWebchatSessionId(body?.sessionId);

    if (!normalizedSessionId) {
      return NextResponse.json(
        { success: false, error: 'sessionId tidak valid' },
        { status: 400 }
      );
    }

    const rateLimitError = enforceWebchatRateLimit(request, normalizedSessionId, 'clear-session');
    if (rateLimitError) return rateLimitError;

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
