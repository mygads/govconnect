/**
 * Voice pipeline — voice note → text → pipeline.
 *
 * Design (arsitektur-final §5.7, v5 multimodal):
 * - When WHISPER_ENABLED=true: download audio → transcribe (OpenAI-compatible
 *   /audio/transcriptions endpoint) → cleanup with a mini-LLM
 *   (micro_nlu lane, cheap tier) → the transcript enters the text pipeline.
 * - When not configured (or transcription fails): a deterministic,
 *   never-silent reply asking the citizen to send text instead.
 * - Graceful degradation is explicit: no Whisper endpoint is fabricated.
 */

import { appendAudit } from './pipeline-store';
import logger from '../utils/logger';

const WHISPER_ENABLED = process.env.WHISPER_ENABLED === 'true';
const WHISPER_API_URL = (process.env.WHISPER_API_URL ?? '').replace(/\/$/, '');
const WHISPER_API_KEY = process.env.WHISPER_API_KEY ?? '';
const WHISPER_MODEL = process.env.WHISPER_MODEL ?? 'whisper-1';

export const VOICE_UNAVAILABLE_COPY =
  'Maaf, untuk saat ini saya belum bisa mendengarkan voice note. ' +
  'Boleh diketik saja ya keperluannya, biar bisa saya bantu.';

export const VOICE_FAILED_COPY =
  'Maaf, voice note-nya tidak bisa saya dengarkan dengan jelas. ' +
  'Boleh diketik saja ya keperluannya.';

export function isVoiceNote(mediaType?: string): boolean {
  return /audio|voice|ptt|\bogg\b|opus/i.test(mediaType ?? '');
}

export function isWhisperConfigured(): boolean {
  return WHISPER_ENABLED && WHISPER_API_URL.length > 0 && WHISPER_API_KEY.length > 0;
}

async function fetchAudio(url: string): Promise<Buffer | null> {
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 30_000);
    const res = await fetch(url, { signal: ctrl.signal });
    clearTimeout(t);
    if (!res.ok) return null;
    const buf = Buffer.from(await res.arrayBuffer());
    return buf.length > 0 && buf.length <= 25 * 1024 * 1024 ? buf : null;
  } catch {
    return null;
  }
}

/** Transcribe via an OpenAI-compatible /audio/transcriptions endpoint. */
export async function transcribeVoiceNote(audioUrl: string): Promise<string | null> {
  if (!isWhisperConfigured()) return null;
  try {
    const audio = await fetchAudio(audioUrl);
    if (!audio) return null;
    const form = new FormData();
    form.append('file', new Blob([audio], { type: 'audio/ogg' }), 'voice.ogg');
    form.append('model', WHISPER_MODEL);
    form.append('language', 'id');
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 90_000);
    const res = await fetch(`${WHISPER_API_URL}/audio/transcriptions`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${WHISPER_API_KEY}` },
      body: form,
      signal: ctrl.signal,
    });
    clearTimeout(t);
    if (!res.ok) {
      logger.warn('[voice-pipeline] transcription endpoint error', { status: res.status });
      return null;
    }
    const json = (await res.json()) as { text?: string };
    const text = (json.text ?? '').trim();
    return text.length > 0 ? text : null;
  } catch (err) {
    logger.warn('[voice-pipeline] transcription failed', {
      error: String((err as Error)?.message ?? err).slice(0, 120),
    });
    return null;
  }
}

/** Deterministic cleanup: strip bracketed non-speech markers, normalize space. */
export function deterministicCleanupTranscript(raw: string): string {
  return raw
    .replace(/\[[^\]]*\]/g, ' ')
    .replace(/\([^)]*(musik|hening|suara)[^)]*\)/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 2000);
}

/**
 * Mini-LLM cleanup: fix punctuation/casing of a raw transcript without
 * changing its meaning. Falls back to deterministic cleanup on any failure.
 */
export async function cleanupTranscript(raw: string): Promise<string> {
  const fallback = deterministicCleanupTranscript(raw);
  try {
    const {
      buildPromptMessages, callAIGatewayPrompt, isAIGatewayEnabledAsync,
    } = await import('../services/ai-gateway.service');
    if (!(await isAIGatewayEnabledAsync('llm', null))) return fallback;
    const prompt =
      'Rapikan transkrip voice note Bahasa Indonesia berikut: perbaiki tanda baca dan kapitalisasi, ' +
      'hapus kata pengisi (eh, anu, hmm) yang berlebihan, TAPI jangan ubah makna, jangan tambah ' +
      'informasi, jangan jawab. Output hanya teks rapi.\n\nTranskrip:\n' + raw.slice(0, 1500);
    const res = await callAIGatewayPrompt({
      lane: 'llm',
      modelPriority: [],
      messages: buildPromptMessages(prompt),
      temperature: 0.1,
      maxTokens: 600,
      timeoutMs: 20_000,
      jsonMode: false,
      layerType: 'micro_nlu',
      callType: 'voice_transcript_cleanup',
      context: undefined,
    });
    const cleaned = (res?.text ?? '').trim();
    return cleaned.length > 0 ? cleaned.slice(0, 2000) : fallback;
  } catch {
    return fallback;
  }
}

export interface VoiceHandleResult {
  /** Transcript entering the text pipeline (undefined when unavailable). */
  transcript?: string;
  /** Deterministic user-facing reply when the voice path is unavailable. */
  reply?: string;
}

export async function handleVoiceNote(input: {
  tenantId: string; userId: string; channel: string; traceId: string; audioUrl: string;
}): Promise<VoiceHandleResult> {
  const { tenantId, userId, channel, traceId, audioUrl } = input;
  if (!isWhisperConfigured()) {
    await appendAudit({
      tenantId, traceId, userId, channel, stage: 'INGRESS', event: 'voice_note_unsupported',
      payload: { reason: 'whisper_not_configured' },
    }).catch(() => undefined);
    return { reply: VOICE_UNAVAILABLE_COPY };
  }
  const raw = await transcribeVoiceNote(audioUrl);
  if (!raw) {
    await appendAudit({
      tenantId, traceId, userId, channel, stage: 'INGRESS', event: 'voice_transcribe_failed',
      payload: {},
    }).catch(() => undefined);
    return { reply: VOICE_FAILED_COPY };
  }
  const transcript = await cleanupTranscript(raw);
  await appendAudit({
    tenantId, traceId, userId, channel, stage: 'INGRESS', event: 'voice_transcribed',
    payload: { chars: transcript.length },
  }).catch(() => undefined);
  return { transcript };
}
