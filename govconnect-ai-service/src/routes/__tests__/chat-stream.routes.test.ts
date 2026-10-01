/**
 * Tests for the SSE streaming presentation layer (POST /api/chat/stream).
 *
 * The pipeline is NOT touched here: the processor is mocked, so these tests
 * prove the presentation contract:
 *  - more than one chunk is emitted for a normal answer
 *  - the `done` event carries the complete answer
 *  - no chunk ever contains raw JSON (P0-3, incl. the sanitizer substitute path)
 *  - client disconnect (aborted signal) stops the stream with no writes (P1-5)
 */
import { describe, expect, it, vi } from 'vitest';
import {
  chunkTextForStream,
  stageLabelFor,
  streamAgentTurn,
  STREAM_CHUNK_CHARS,
  type StreamEmit,
  type StreamProcessor,
  type StreamProcessorInput,
} from '../../services/sse-stream.service';
import type { ProcessMessageResult } from '../../services/ump-types';
import { RAW_JSON_SUBSTITUTE_COPY, looksLikeRawJson } from '../../pipeline/outbound-sanitizer';

interface CapturedEvent {
  event: string;
  data: any;
}

function makeCapture() {
  const events: CapturedEvent[] = [];
  const emit: StreamEmit = (event, data) => {
    events.push({ event, data });
  };
  return { events, emit };
}

function okResult(overrides: Partial<ProcessMessageResult> = {}): ProcessMessageResult {
  return {
    success: true,
    response: 'Halo! Ada yang bisa saya bantu terkait layanan desa hari ini?',
    intent: 'GENERAL_INFO',
    metadata: { processingTimeMs: 120, hasKnowledge: false },
    ...overrides,
  } as ProcessMessageResult;
}

const baseInput: StreamProcessorInput = {
  userId: 'web_test_1',
  message: 'halo',
  village_id: 'village-test',
};

const LONG_ANSWER =
  'Untuk membuat surat keterangan domisili, Anda perlu membawa fotokopi KTP dan KK ke kantor desa. ' +
  'Pelayanan dibuka Senin sampai Jumat pukul 08.00 hingga 14.00. Surat biasanya selesai pada hari yang sama ' +
  'apabila berkas lengkap. Apabila ada kendala, silakan hubungi perangkat desa melalui WhatsApp resmi.';

describe('chunkTextForStream', () => {
  it('splits a long answer into more than one chunk', () => {
    const chunks = chunkTextForStream(LONG_ANSWER);
    expect(chunks.length).toBeGreaterThan(1);
    for (const c of chunks) {
      expect(c.length).toBeGreaterThan(0);
      expect(c.length).toBeLessThanOrEqual(STREAM_CHUNK_CHARS + 40); // word-aware: may exceed by one long word
    }
  });

  it('reconstructs the original text exactly when joined', () => {
    const chunks = chunkTextForStream(LONG_ANSWER);
    expect(chunks.join('')).toBe(LONG_ANSWER);
  });

  it('returns an empty array for empty input', () => {
    expect(chunkTextForStream('')).toEqual([]);
  });

  it('keeps a short reply as a single chunk', () => {
    const chunks = chunkTextForStream('Baik, siap.');
    expect(chunks).toEqual(['Baik, siap.']);
  });
});

describe('stageLabelFor', () => {
  it('maps pipeline stages to Indonesian progress copy', () => {
    expect(stageLabelFor('searching')).toBe('Mencari informasi…');
    expect(stageLabelFor('thinking')).toBe('Menyusun jawaban…');
  });

  it('falls back to a generic label for unknown stages', () => {
    expect(stageLabelFor('something-new')).toBe('Memproses…');
  });
});

describe('streamAgentTurn', () => {
  it('streams >1 chunks and the done event carries the complete answer', async () => {
    const { events, emit } = makeCapture();
    const processor: StreamProcessor = vi.fn(async (input) => {
      input.onStageChange?.('searching', 40);
      input.onStageChange?.('thinking', 70);
      return okResult({ response: LONG_ANSWER });
    });

    const summary = await streamAgentTurn({
      input: baseInput,
      processor,
      emit,
      signal: null,
      chunkDelayMs: 0,
    });

    expect(summary.outcome).toBe('done');
    expect(summary.fullText).toBe(LONG_ANSWER);

    const chunks = events.filter((e) => e.event === 'chunk');
    expect(chunks.length).toBeGreaterThan(1);

    // The streamed chunks reconstruct the complete answer.
    expect(chunks.map((c) => c.data.text).join('')).toBe(LONG_ANSWER);

    const done = events.filter((e) => e.event === 'done');
    expect(done).toHaveLength(1);
    expect(done[0].data.fullText).toBe(LONG_ANSWER);
    expect(done[0].data.intent).toBe('GENERAL_INFO');

    // No raw JSON in any chunk (P0-3).
    for (const c of chunks) {
      expect(looksLikeRawJson(c.data.text)).toBe(false);
    }
    expect(looksLikeRawJson(done[0].data.fullText)).toBe(false);

    // Stage progress was streamed with Indonesian copy.
    const stages = events.filter((e) => e.event === 'stage');
    expect(stages.length).toBeGreaterThanOrEqual(2);
    expect(stages[0].data.message).toBe('Mencari informasi…');
  });

  it('never streams raw JSON: the sanitizer substitute is used instead (P0-3)', async () => {
    const { events, emit } = makeCapture();
    const processor: StreamProcessor = vi.fn(async () =>
      okResult({ response: '{"jawaban":"ini json mentah","tiket":"LAP-1"}' })
    );

    const summary = await streamAgentTurn({
      input: baseInput,
      processor,
      emit,
      signal: null,
      chunkDelayMs: 0,
    });

    expect(summary.outcome).toBe('done');
    expect(summary.sanitizerSubstituted).toBe(true);
    expect(summary.fullText).toBe(RAW_JSON_SUBSTITUTE_COPY);

    const chunks = events.filter((e) => e.event === 'chunk');
    expect(chunks.length).toBeGreaterThan(0);
    const streamedText = chunks.map((c) => c.data.text).join('');
    expect(streamedText).toContain('kendala teknis');
    expect(streamedText).not.toContain('{"jawaban"');
    for (const c of chunks) {
      expect(looksLikeRawJson(c.data.text)).toBe(false);
    }

    const done = events.filter((e) => e.event === 'done');
    expect(done[0].data.fullText).toBe(RAW_JSON_SUBSTITUTE_COPY);
    expect(done[0].data.sanitizerSubstituted).toBe(true);
  });

  it('stops immediately when the client disconnected before the turn (P1-5)', async () => {
    const { events, emit } = makeCapture();
    const controller = new AbortController();
    controller.abort();
    const processor: StreamProcessor = vi.fn(async () => okResult({ response: LONG_ANSWER }));

    const summary = await streamAgentTurn({
      input: baseInput,
      processor,
      emit,
      signal: controller.signal,
      chunkDelayMs: 0,
    });

    expect(summary.outcome).toBe('aborted');
    expect(events.filter((e) => e.event === 'chunk')).toHaveLength(0);
    expect(events.filter((e) => e.event === 'done')).toHaveLength(0);
    expect(events).toHaveLength(0);
  });

  it('stops mid-stream when the client disconnects during chunking (P1-5)', async () => {
    const events: CapturedEvent[] = [];
    const controller = new AbortController();
    let chunkCount = 0;
    const emit: StreamEmit = (event, data) => {
      events.push({ event, data });
      if (event === 'chunk') {
        chunkCount++;
        if (chunkCount === 1) controller.abort(); // client hangs up after first chunk
      }
    };
    const processor: StreamProcessor = vi.fn(async () => okResult({ response: LONG_ANSWER }));

    const summary = await streamAgentTurn({
      input: baseInput,
      processor,
      emit,
      signal: controller.signal,
      chunkDelayMs: 0,
    });

    expect(summary.outcome).toBe('aborted');
    expect(events.filter((e) => e.event === 'done')).toHaveLength(0);
    // Only the first chunk went out; no done, no further chunks.
    expect(events.filter((e) => e.event === 'chunk')).toHaveLength(1);
  });

  it('streams the static fallback as degraded when the pipeline failed but has one (BUG-008)', async () => {
    const { events, emit } = makeCapture();
    const processor: StreamProcessor = vi.fn(async () =>
      okResult({
        success: false,
        error: 'LLM_TIMEOUT',
        response: 'Laporan Anda sudah tercatat dengan nomor LAP-20250101-001. Petugas desa akan menindaklanjuti.',
        intent: 'CREATE_COMPLAINT',
      })
    );

    const summary = await streamAgentTurn({
      input: baseInput,
      processor,
      emit,
      signal: null,
      chunkDelayMs: 0,
    });

    expect(summary.outcome).toBe('degraded');
    const chunks = events.filter((e) => e.event === 'chunk');
    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks[0].data.kind).toBe('fallback');
    const done = events.filter((e) => e.event === 'done');
    expect(done[0].data.degraded).toBe(true);
    expect(done[0].data.fullText).toContain('LAP-20250101-001');
  });

  it('emits an error event when the pipeline failed with nothing deliverable', async () => {
    const { events, emit } = makeCapture();
    const processor: StreamProcessor = vi.fn(async () =>
      okResult({ success: false, error: 'LLM_DOWN', response: '' })
    );

    const summary = await streamAgentTurn({
      input: baseInput,
      processor,
      emit,
      signal: null,
      chunkDelayMs: 0,
    });

    expect(summary.outcome).toBe('error');
    const errors = events.filter((e) => e.event === 'error');
    expect(errors).toHaveLength(1);
    expect(errors[0].data.code).toBe('PROCESSING_FAILED');
    expect(events.filter((e) => e.event === 'chunk')).toHaveLength(0);
  });

  it('emits a held event when the wallet holds the message', async () => {
    const { events, emit } = makeCapture();
    const processor: StreamProcessor = vi.fn(async () =>
      okResult({ response: '', intent: 'AI_BALANCE_HELD' })
    );

    const summary = await streamAgentTurn({
      input: baseInput,
      processor,
      emit,
      signal: null,
      chunkDelayMs: 0,
    });

    expect(summary.outcome).toBe('held');
    expect(events.filter((e) => e.event === 'held')).toHaveLength(1);
    expect(events.filter((e) => e.event === 'chunk')).toHaveLength(0);
  });

  it('emits a timeout error when the pipeline exceeds the turn budget', async () => {
    const { events, emit } = makeCapture();
    const processor: StreamProcessor = vi.fn(
      () => new Promise<ProcessMessageResult>(() => {}) // never resolves
    );

    const summary = await streamAgentTurn({
      input: baseInput,
      processor,
      emit,
      signal: null,
      chunkDelayMs: 0,
      timeoutMs: 50,
    });

    expect(summary.outcome).toBe('error');
    const errors = events.filter((e) => e.event === 'error');
    expect(errors).toHaveLength(1);
    expect(errors[0].data.code).toBe('PROCESSING_TIMEOUT');
  });
});
