/**
 * Webchat Clear Session API
 * POST /api/webchat/clear-session
 * Clears AI caches/profile for a webchat session so user starts fresh.
 */

import { NextRequest, NextResponse } from 'next/server';
import { buildUrl, ServicePath, INTERNAL_API_KEY } from '@/lib/api-client';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { sessionId } = body;

    if (!sessionId) {
      return NextResponse.json(
        { success: false, error: 'sessionId diperlukan' },
        { status: 400 }
      );
    }

    // Call AI Service to clear user caches and profile
    const clearUrl = buildUrl(ServicePath.AI, '/admin/cache/clear-user');

    const response = await fetch(clearUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-internal-api-key': INTERNAL_API_KEY,
      },
      body: JSON.stringify({ userId: sessionId }),
    });

    if (!response.ok) {
      console.error('Failed to clear AI cache:', await response.text());
      // Non-blocking — still return success for UX
    }

    return NextResponse.json({ success: true });
  } catch (error: any) {
    console.error('Clear session error:', error);
    // Non-blocking — return success regardless so UI flow isn't interrupted
    return NextResponse.json({ success: true });
  }
}
