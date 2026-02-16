/**
 * Web Chat API Route
 * Endpoint untuk live chat widget di landing page
 * Berkomunikasi dengan AI Service untuk mendapatkan respons
 */

import { NextRequest, NextResponse } from 'next/server';
import { buildUrl, ServicePath, INTERNAL_API_KEY } from '@/lib/api-client';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { sessionId, message, villageId } = body;

    if (!sessionId || !message || !villageId) {
      return NextResponse.json(
        { success: false, error: 'Session ID, villageId, dan pesan diperlukan' },
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

    // Call AI Service webchat endpoint
    const aiServiceUrl = buildUrl(ServicePath.AI, '/api/webchat');
    
    const aiResponse = await fetch(aiServiceUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-internal-api-key': INTERNAL_API_KEY,
      },
      body: JSON.stringify({
        session_id: sessionId,
        message: message,
        channel: 'web',
        village_id: villageId,
      }),
    });

    if (!aiResponse.ok) {
      const errorText = await aiResponse.text();
      console.error('AI Service error:', errorText);
      
      // Fallback response jika AI service tidak tersedia
      return NextResponse.json({
        success: true,
        response: getFallbackResponse(message),
        isFallback: true,
      });
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
    
    // Return fallback response instead of error
    return NextResponse.json({
      success: true,
      response: 'Maaf, sistem sedang dalam pemeliharaan. Silakan hubungi kami via WhatsApp atau coba lagi nanti.',
      isFallback: true,
    });
  }
}

// Fallback responses when AI service is unavailable
function getFallbackResponse(message: string): string {
  const lowerMessage = message.toLowerCase();
  
  if (lowerMessage.includes('halo') || lowerMessage.includes('hai') || lowerMessage.includes('hi')) {
    return 'Halo! Selamat datang di Tanggapin AI. Saat ini sistem AI sedang dalam pemeliharaan. Untuk layanan lebih cepat, silakan hubungi kami via WhatsApp. Terima kasih! 🙏';
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
  
  return 'Terima kasih telah menghubungi Tanggapin AI. Sistem AI sedang dalam pemeliharaan. Untuk layanan lebih cepat, silakan hubungi kami via WhatsApp. 🙏';
}

// Health check
export async function GET() {
  return NextResponse.json({ status: 'ok', service: 'webchat' });
}
