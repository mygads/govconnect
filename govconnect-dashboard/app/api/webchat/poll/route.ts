/**
 * Web Chat Poll API Route
 * Endpoint untuk polling admin messages dan takeover status
 * Digunakan oleh webchat widget untuk menerima pesan dari admin
 */

import { NextRequest, NextResponse } from 'next/server';
import { buildUrl, ServicePath, getInternalApiKey } from '@/lib/api-client';
import { enforceWebchatRateLimit, validateWebchatSessionId, validateWebchatVillageId } from '@/lib/webchat-guard';

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const sessionId = validateWebchatSessionId(searchParams.get('sessionId'));
    const villageId = validateWebchatVillageId(searchParams.get('villageId'));
    const since = searchParams.get('since');

    if (!sessionId) {
      return NextResponse.json(
        { success: false, error: 'Session ID tidak valid' },
        { status: 400 }
      );
    }

    const rawVillageId = searchParams.get('villageId');
    if (rawVillageId && !villageId) {
      return NextResponse.json(
        { success: false, error: 'villageId tidak valid' },
        { status: 400 }
      );
    }

    const rateLimitError = enforceWebchatRateLimit(request, sessionId, 'poll');
    if (rateLimitError) return rateLimitError;

    // Call AI Service webchat poll endpoint
    const baseUrl = buildUrl(ServicePath.AI, `/api/webchat/${sessionId}/poll`);
    const pollUrl = new URL(baseUrl);
    if (since) {
      pollUrl.searchParams.set('since', since);
    }
    if (villageId) {
      pollUrl.searchParams.set('village_id', villageId);
    }
    
    const pollResponse = await fetch(pollUrl.toString(), {
      method: 'GET',
      headers: {
        'x-internal-api-key': getInternalApiKey(),
      },
    });

    const pollData = await pollResponse.json().catch(() => null);
    if (!pollResponse.ok) {
      return NextResponse.json(
        pollData || { success: false, error: 'Failed to poll webchat state', code: 'UPSTREAM_UNAVAILABLE' },
        { status: pollResponse.status },
      );
    }

    return NextResponse.json({
      success: true,
      is_takeover: pollData?.is_takeover || false,
      admin_name: pollData?.admin_name || null,
      messages: pollData?.messages || [],
    });

  } catch (error: any) {
    console.error('Web chat poll error:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to poll webchat state', code: 'UPSTREAM_UNAVAILABLE' },
      { status: 503 },
    );
  }
}
