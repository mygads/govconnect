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

function inferAudioFormat(mediaUrl?: string): string {
  const normalized = (mediaUrl || '').toLowerCase();
  if (normalized.includes('.mp3')) return 'mp3';
  if (normalized.includes('.ogg') || normalized.includes('.opus') || normalized.includes('.oga')) return 'ogg';
  if (normalized.includes('.webm')) return 'webm';
  return 'wav';
}

async function fetchMediaAsBase64(mediaUrl: string): Promise<{ data: string; format: string }> {
  const response = await fetch(mediaUrl);
  if (!response.ok) {
    throw new Error(`Failed to fetch media: HTTP ${response.status}`);
  }

  const bytes = Buffer.from(await response.arrayBuffer());
  if (bytes.length === 0) {
    throw new Error('Fetched media is empty');
  }

  const contentType = response.headers.get('content-type') || '';
  const format = inferAudioFormat(contentType || mediaUrl);
  return {
    data: bytes.toString('base64'),
    format,
  };
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
      const audio = await fetchMediaAsBase64(input.mediaUrl);
      const result = await callAIGatewayPrompt({
        lane: 'llm',
        modelPriority: [],
        requiredCapability: 'audio',
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
            content: 'Anda menganalisis audio laporan warga desa. Transkripsikan inti audio secara ringkas dalam Bahasa Indonesia, jelaskan keluhan/permintaan warga jika jelas, dan jangan mengarang detail yang tidak terdengar.',
          },
          {
            role: 'user',
            content: [
              { type: 'text', text: input.message && input.message !== '[Audio]' ? `Pesan pendamping warga: ${input.message}` : 'Warga mengirim audio tanpa penjelasan teks.' },
              { type: 'input_audio', input_audio: { data: audio.data, format: audio.format } },
            ],
          },
        ],
      });

      if (!result?.text) {
        return {
          status: 'failed',
          response: 'Audio sudah kami terima, tetapi isi suaranya belum berhasil kami pahami. Mohon kirim ringkasan teksnya ya, Pak/Bu.',
        };
      }

      return { status: 'ok', description: result.text.trim() };
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
      if (needsAudio) {
        return {
          status: 'unsupported',
          response: 'Audio sudah kami terima. Saat ini model AI belum mendukung pembacaan audio, jadi mohon kirim ringkasan teksnya ya, Pak/Bu.',
        };
      }
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
    if (needsAudio) {
      return {
        status: 'failed',
        response: 'Audio sudah kami terima, tetapi belum berhasil kami proses. Mohon kirim ringkasan teksnya ya, Pak/Bu.',
      };
    }
    return {
      status: 'failed',
      response: 'Foto sudah kami terima. Mohon jelaskan singkat kendala pada foto tersebut agar bisa kami bantu proses ya, Pak/Bu.',
    };
  }
}
