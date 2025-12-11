/**
 * Webchat Processing Status API
 * 
 * GET /api/webchat/status?sessionId=xxx
 * Returns the current AI processing status for a webchat session
 */

import { NextRequest, NextResponse } from 'next/server';
import { API_BASE_URL, ServicePath, INTERNAL_API_KEY } from '@/lib/api-client';

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const sessionId = searchParams.get('sessionId');

    if (!sessionId) {
      return NextResponse.json(
        { success: false, error: 'Session ID is required' },
        { status: 400 }
      );
    }

    // Call AI Service status endpoint
    const statusUrl = `${API_BASE_URL}${ServicePath.AI}/api/status/${encodeURIComponent(sessionId)}`;
    
    const response = await fetch(statusUrl, {
      headers: {
        'X-Internal-API-Key': INTERNAL_API_KEY,
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
