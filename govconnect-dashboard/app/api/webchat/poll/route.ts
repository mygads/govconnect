/**
 * Web Chat Poll API Route
 * Endpoint untuk polling admin messages dan takeover status
 * Digunakan oleh webchat widget untuk menerima pesan dari admin
 */

import { NextRequest, NextResponse } from 'next/server';
import { API_BASE_URL, ServicePath, INTERNAL_API_KEY } from '@/lib/api-client';

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const sessionId = searchParams.get('sessionId');
    const since = searchParams.get('since');

    if (!sessionId) {
      return NextResponse.json(
        { success: false, error: 'Session ID diperlukan' },
        { status: 400 }
      );
    }

    // Validate session ID format (must start with web_)
    if (!sessionId.startsWith('web_')) {
      return NextResponse.json(
        { success: false, error: 'Format session ID tidak valid' },
        { status: 400 }
      );
    }

    // Call AI Service webchat poll endpoint
    const pollUrl = new URL(`${API_BASE_URL}${ServicePath.AI}/api/webchat/${sessionId}/poll`);
    if (since) {
      pollUrl.searchParams.set('since', since);
    }
    
    const pollResponse = await fetch(pollUrl.toString(), {
      method: 'GET',
      headers: {
        'x-internal-api-key': INTERNAL_API_KEY,
      },
    });

    if (!pollResponse.ok) {
      // Return default response if poll fails
      return NextResponse.json({
        success: true,
        is_takeover: false,
        admin_name: null,
        messages: [],
      });
    }

    const pollData = await pollResponse.json();

    return NextResponse.json({
      success: true,
      is_takeover: pollData.is_takeover || false,
      admin_name: pollData.admin_name || null,
      messages: pollData.messages || [],
    });

  } catch (error: any) {
    console.error('Web chat poll error:', error);
    
    // Return default response on error
    return NextResponse.json({
      success: true,
      is_takeover: false,
      admin_name: null,
      messages: [],
    });
  }
}
