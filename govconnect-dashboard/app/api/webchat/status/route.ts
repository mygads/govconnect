/**
 * Webchat Processing Status API
 * 
 * GET /api/webchat/status?sessionId=xxx
 * Returns the current AI processing status for a webchat session
 */

import { NextRequest, NextResponse } from 'next/server';
import { buildUrl, ServicePath, getInternalApiKey } from '@/lib/api-client';
import { enforceWebchatRateLimit, validateWebchatSessionId } from '@/lib/webchat-guard';

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const sessionId = validateWebchatSessionId(searchParams.get('sessionId'));

    if (!sessionId) {
      return NextResponse.json(
        { success: false, error: 'Session ID is invalid' },
        { status: 400 }
      );
    }

    const rateLimitError = enforceWebchatRateLimit(request, sessionId, 'status');
    if (rateLimitError) return rateLimitError;

    // Call AI Service status endpoint
    const statusUrl = buildUrl(ServicePath.AI, `/api/status/${encodeURIComponent(sessionId)}`);
    
    const response = await fetch(statusUrl, {
      headers: {
        'X-Internal-API-Key': getInternalApiKey(),
        'Content-Type': 'application/json',
      },
    });

    if (!response.ok) {
      return NextResponse.json({
        success: true,
        data: {
          isProcessing: false,
          status: null,
        },
      });
    }

    const data = await response.json();
    return NextResponse.json(data);
  } catch (error) {
    console.error('Error fetching webchat status:', error);
    return NextResponse.json({
      success: true,
      data: {
        isProcessing: false,
        status: null,
      },
    });
  }
}
