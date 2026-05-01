/**
 * Web Chat API Route
 * Endpoint untuk live chat widget di landing page
 * Berkomunikasi dengan AI Service untuk mendapatkan respons
 */

import { NextRequest, NextResponse } from 'next/server';
import { buildUrl, ServicePath, getInternalApiKey } from '@/lib/api-client';
import { enforceWebchatRateLimit, normalizeWebchatMessage, validateWebchatSessionId, validateWebchatVillageId } from '@/lib/webchat-guard';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const sessionId = validateWebchatSessionId(body.sessionId);
    const message = normalizeWebchatMessage(body.message);
    const villageId = validateWebchatVillageId(body.villageId);

    if (!sessionId || !message || !villageId) {
      return NextResponse.json(
        { success: false, error: 'Session ID, villageId, atau pesan tidak valid' },
        { status: 400 }
      );
    }

    const rateLimitError = enforceWebchatRateLimit(request, sessionId, 'message');
    if (rateLimitError) return rateLimitError;

    // Call AI Service webchat endpoint
    const aiServiceUrl = buildUrl(ServicePath.AI, '/api/webchat');
    
    const aiResponse = await fetch(aiServiceUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-internal-api-key': getInternalApiKey(),
      },
      body: JSON.stringify({
        session_id: sessionId,
        message: message,
        channel: 'web',
        village_id: villageId,
      }),
    });

    if (!aiResponse.ok) {
      const errorData = await aiResponse.json().catch(() => null);
      console.error('AI Service error:', errorData);
      return NextResponse.json(
        errorData
          ? {
              ...errorData,
              success: false,
              fallbackResponse: errorData.fallbackResponse || errorData.response || getFallbackResponse(message),
            }
          : {
              success: false,
              error: 'AI service unavailable',
              code: 'UPSTREAM_UNAVAILABLE',
              fallbackResponse: getFallbackResponse(message),
            },
        { status: aiResponse.status },
      );
    }

    const aiData = await aiResponse.json();

    // During takeover, AI returns empty response (intent: TAKEOVER).
    // We must preserve empty string — do NOT replace with fallback text.
    const responseText = aiData.response ?? aiData.message ?? '';

    return NextResponse.json({
      success: true,
      response: responseText,
      guidanceText: aiData.guidanceText || '',
      metadata: aiData.metadata,
      intent: aiData.metadata?.intent,
    });

  } catch (error: any) {
    console.error('Web chat error:', error);
    return NextResponse.json(
      {
        success: false,
        error: 'Webchat service unavailable',
        code: 'UPSTREAM_UNAVAILABLE',
        fallbackResponse: 'Maaf, sistem sedang dalam pemeliharaan. Silakan hubungi kami via WhatsApp atau coba lagi nanti.',
      },
      { status: 503 },
    );
  }
}

// Fallback responses when AI service is unavailable
function getFallbackResponse(message: string): string {
  const lowerMessage = message.toLowerCase();
  
  if (lowerMessage.includes('halo') || lowerMessage.includes('hai') || lowerMessage.includes('hi')) {
    return 'Halo! Selamat datang di GovConnect. Saat ini sistem AI sedang dalam pemeliharaan. Untuk layanan lebih cepat, silakan hubungi kami via WhatsApp. Terima kasih! 🙏';
  }
  
  if (lowerMessage.includes('surat') || lowerMessage.includes('dokumen')) {
    return 'Untuk pengajuan surat dan dokumen, silakan hubungi kami via WhatsApp atau datang langsung ke kantor kelurahan. Sistem AI sedang dalam pemeliharaan.';
  }
  
  if (lowerMessage.includes('lapor') || lowerMessage.includes('keluhan') || lowerMessage.includes('aduan')) {
    return 'Untuk melaporkan keluhan atau aduan, silakan hubungi kami via WhatsApp agar dapat ditindaklanjuti dengan cepat. Sistem AI sedang dalam pemeliharaan.';
  }
  
  if (lowerMessage.includes('jam') || lowerMessage.includes('buka') || lowerMessage.includes('operasional')) {
    return 'Jam operasional kantor kelurahan: Senin-Jumat pukul 08:00-16:00 WIB. Untuk informasi lebih lanjut, silakan hubungi via WhatsApp.';
  }
  
  return 'Terima kasih telah menghubungi GovConnect. Sistem AI sedang dalam pemeliharaan. Untuk layanan lebih cepat, silakan hubungi kami via WhatsApp. 🙏';
}

// Health check
export async function GET() {
  return NextResponse.json({ status: 'ok', service: 'webchat' });
}
