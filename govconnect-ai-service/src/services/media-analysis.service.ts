import { callAIGatewayPrompt, NoCapableGatewayModelError } from './ai-gateway.service';
import logger from '../utils/logger';

export type MediaAnalysisResult =
  | { status: 'ok'; description: string }
  | { status: 'unsupported' | 'failed'; response: string };

function mediaNeedsVision(mediaType?: string): boolean {
  return ['image', 'photo'].includes((mediaType || '').toLowerCase());
}

function mediaNeedsAudio(mediaType?: string): boolean {
  return ['audio', 'voice'].includes((mediaType || '').toLowerCase());
}

export async function analyzeIncomingMedia(input: {
  mediaUrl?: string;
  mediaType?: string;
  message: string;
  villageId?: string;
  userId: string;
  channel: 'whatsapp' | 'webchat';
}): Promise<MediaAnalysisResult | null> {
  if (!input.mediaUrl) return null;

  const needsVision = mediaNeedsVision(input.mediaType);
  const needsAudio = mediaNeedsAudio(input.mediaType);
  if (!needsVision && !needsAudio) return null;

  try {
    if (needsAudio) {
      return {
        status: 'unsupported',
        response: 'Mohon maaf, saat ini audio belum bisa dibaca otomatis. Silakan ketik ringkasan isi audio tersebut ya, Pak/Bu.',
      };
    }

    const result = await callAIGatewayPrompt({
      lane: 'llm',
      modelPriority: [],
      requiredCapability: 'vision',
      temperature: 0.1,
      maxTokens: 350,
      layerType: 'full_nlu',
      callType: 'media_analysis',
      context: {
        village_id: input.villageId,
        wa_user_id: input.channel === 'whatsapp' ? input.userId : null,
        session_id: input.channel === 'webchat' ? input.userId : null,
        channel: input.channel,
      },
      messages: [
        {
          role: 'system',
          content: 'Anda menganalisis gambar laporan warga desa. Jelaskan isi gambar secara ringkas dalam Bahasa Indonesia, sebutkan kerusakan/kendala yang terlihat, lokasi/teks yang terbaca jika ada, dan jangan mengarang detail yang tidak terlihat.',
        },
        {
          role: 'user',
          content: [
            { type: 'text', text: input.message && input.message !== '[Image]' ? `Pesan/caption warga: ${input.message}` : 'Warga mengirim gambar tanpa penjelasan teks.' },
            { type: 'image_url', image_url: { url: input.mediaUrl } },
          ],
        },
      ],
    });

    if (!result?.text) {
      return {
        status: 'failed',
        response: 'Foto sudah kami terima. Mohon jelaskan singkat kendala pada foto tersebut agar bisa kami bantu proses ya, Pak/Bu.',
      };
    }

    return { status: 'ok', description: result.text.trim() };
  } catch (error: any) {
    if (error instanceof NoCapableGatewayModelError) {
      return {
        status: 'unsupported',
        response: 'Foto sudah kami terima. Saat ini model AI belum mendukung pembacaan gambar, jadi mohon jelaskan kendala pada foto tersebut ya, Pak/Bu.',
      };
    }

    logger.warn('Incoming media analysis failed', {
      error: error?.message || String(error),
      mediaType: input.mediaType,
      villageId: input.villageId,
    });
    return {
      status: 'failed',
      response: 'Foto sudah kami terima. Mohon jelaskan singkat kendala pada foto tersebut agar bisa kami bantu proses ya, Pak/Bu.',
    };
  }
}
