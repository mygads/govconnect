import { NextRequest } from 'next/server';
import { buildUrl, ServicePath, getInternalApiKey } from '@/lib/api-client';
import { enforceWebchatRateLimit, validateWebchatSessionId, validateWebchatVillageId } from '@/lib/webchat-guard';

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const sessionId = validateWebchatSessionId(searchParams.get('sessionId'));
    const villageId = validateWebchatVillageId(searchParams.get('villageId'));

    if (!sessionId || !villageId) {
      return new Response('Session ID atau villageId tidak valid', { status: 400 });
    }

    const rateLimitError = enforceWebchatRateLimit(request, sessionId, 'poll');
    if (rateLimitError) {
      return new Response('Rate limit exceeded', { status: rateLimitError.status });
    }

    const upstreamUrl = buildUrl(
      ServicePath.AI,
      `/api/webchat/${encodeURIComponent(sessionId)}/events?village_id=${encodeURIComponent(villageId)}`
    );

    const upstream = await fetch(upstreamUrl, {
      headers: {
        'x-internal-api-key': getInternalApiKey(),
        Accept: 'text/event-stream',
      },
      signal: request.signal,
    });

    if (!upstream.ok || !upstream.body) {
      return new Response('Webchat realtime unavailable', { status: upstream.status || 502 });
    }

    return new Response(upstream.body, {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache, no-transform',
        Connection: 'keep-alive',
        'X-Accel-Buffering': 'no',
      },
    });
  } catch {
    return new Response('Webchat realtime unavailable', { status: 503 });
  }
}
