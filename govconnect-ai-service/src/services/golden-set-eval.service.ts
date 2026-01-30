import logger from '../utils/logger';
import { callLayer1LLM, Layer1Output, applyTypoCorrections } from './layer1-llm.service';
import { callLayer2LLM, generateFallbackResponse, Layer2Output } from './layer2-llm.service';
import { extractAllEntities } from './entity-extractor.service';
import { sanitizeUserInput } from './context-builder.service';
import { getKelurahanInfoContext, getRAGContext } from './knowledge.service';
import { shouldRetrieveContext } from './rag.service';

export type GoldenSetItem = {
  id: string;
  query: string;
  expected_intent?: string;
  expected_keywords?: string[];
  village_id?: string;
};

export type GoldenSetItemResult = {
  id: string;
  query: string;
  expected_intent?: string;
  predicted_intent: string;
  reply_text: string;
  intent_match?: boolean;
  keyword_match?: boolean;
  keyword_score?: number;
  score: number;
  latency_ms: number;
};

export type GoldenSetSummary = {
  run_id: string;
  total: number;
  intent_accuracy: number;
  keyword_accuracy: number;
  overall_accuracy: number;
  thresholds: {
    overall: number;
    intent: number;
    keyword: number;
    regression_delta: number;
  };
  status: {
    overall_pass: boolean;
    intent_pass: boolean;
    keyword_pass: boolean;
    regression_detected: boolean;
  };
  started_at: string;
  completed_at: string;
  results: GoldenSetItemResult[];
};

const history: GoldenSetSummary[] = [];
const MAX_HISTORY = 10;
const THRESHOLD_OVERALL = parseFloat(process.env.GOLDEN_SET_THRESHOLD_OVERALL || '0.75');
const THRESHOLD_INTENT = parseFloat(process.env.GOLDEN_SET_THRESHOLD_INTENT || '0.75');
const THRESHOLD_KEYWORD = parseFloat(process.env.GOLDEN_SET_THRESHOLD_KEYWORD || '0.7');
const REGRESSION_DELTA = parseFloat(process.env.GOLDEN_SET_REGRESSION_DELTA || '0.05');

function normalizeText(text: string): string {
  return (text || '').toLowerCase();
}

function computeKeywordScore(replyText: string, expectedKeywords?: string[]): { match: boolean; score: number } {
  if (!expectedKeywords || expectedKeywords.length === 0) {
    return { match: true, score: 1 };
  }
  const replyLower = normalizeText(replyText);
  const matched = expectedKeywords.filter((kw) => replyLower.includes(normalizeText(kw)));
  const score = matched.length / expectedKeywords.length;
  return { match: score >= 0.6, score };
}

function toSafeLayer1Fallback(message: string): Layer1Output {
  return {
    intent: 'UNKNOWN',
    normalized_message: message,
    extracted_data: {},
    confidence: 0.1,
    needs_clarification: [],
    processing_notes: [],
  } as unknown as Layer1Output;
}

async function buildKnowledgeContext(message: string, villageId?: string): Promise<string> {
  try {
    const resolvedVillageId = villageId || process.env.DEFAULT_VILLAGE_ID;
    const isGreeting = /^(halo|hai|hi|hello|selamat\s+(pagi|siang|sore|malam)|assalamualaikum|permisi)/i.test(message.trim());
    const looksLikeQuestion = shouldRetrieveContext(message);

    if (isGreeting) {
      const info = await getKelurahanInfoContext(resolvedVillageId);
      if (info && info.trim()) {
        return `KNOWLEDGE BASE YANG TERSEDIA:\n${info}`;
      }
    } else if (looksLikeQuestion) {
      const rag = await getRAGContext(message, undefined, resolvedVillageId);
      if (rag?.totalResults > 0 && rag.contextString) {
        return `KNOWLEDGE BASE YANG TERSEDIA:\n${rag.contextString}`;
      }
    }
  } catch (error: any) {
    logger.warn('Golden set knowledge prefetch failed', { error: error.message });
  }

  return '';
}

export async function runGoldenSetEvaluation(items: GoldenSetItem[], defaultVillageId?: string): Promise<GoldenSetSummary> {
  const runId = `golden-${Date.now()}`;
  const startedAt = new Date().toISOString();
  const results: GoldenSetItemResult[] = [];

  for (const item of items) {
    const startItem = Date.now();
    const sanitized = applyTypoCorrections(sanitizeUserInput(item.query));
    const preExtracted = extractAllEntities(sanitized, '');
    const waUser = `golden_eval_${item.id}`;

    let layer1Output = await callLayer1LLM({
      message: sanitized,
      wa_user_id: waUser,
      conversation_history: '',
      pre_extracted_data: preExtracted.entities,
    });

    if (!layer1Output) {
      layer1Output = toSafeLayer1Fallback(sanitized);
    }

    const knowledgeContext = await buildKnowledgeContext(sanitized, item.village_id || defaultVillageId);

    const layer2Input = {
      layer1_output: layer1Output,
      wa_user_id: waUser,
      conversation_context: knowledgeContext || 'Percakapan baru',
      user_name: layer1Output.extracted_data?.nama_lengkap,
    };

    let layer2Output: Layer2Output | null = await callLayer2LLM(layer2Input);
    if (!layer2Output) {
      layer2Output = generateFallbackResponse(layer1Output);
    }

    const intentMatch = item.expected_intent
      ? layer1Output.intent === item.expected_intent
      : undefined;

    const keywordScore = computeKeywordScore(layer2Output.reply_text, item.expected_keywords);

    const scoreParts: number[] = [];
    if (typeof intentMatch === 'boolean') scoreParts.push(intentMatch ? 1 : 0);
    if (item.expected_keywords && item.expected_keywords.length > 0) scoreParts.push(keywordScore.score);

    const score = scoreParts.length > 0
      ? scoreParts.reduce((acc, cur) => acc + cur, 0) / scoreParts.length
      : 1;

    results.push({
      id: item.id,
      query: item.query,
      expected_intent: item.expected_intent,
      predicted_intent: layer1Output.intent,
      reply_text: layer2Output.reply_text,
      intent_match: intentMatch,
      keyword_match: item.expected_keywords ? keywordScore.match : undefined,
      keyword_score: item.expected_keywords ? keywordScore.score : undefined,
      score,
      latency_ms: Date.now() - startItem,
    });
  }

  const total = results.length || 1;
  const intentChecks = results.filter(r => typeof r.intent_match === 'boolean');
  const keywordChecks = results.filter(r => typeof r.keyword_score === 'number');

  const intentAccuracy = intentChecks.length
    ? (intentChecks.filter(r => r.intent_match).length / intentChecks.length)
    : 1;

  const keywordAccuracy = keywordChecks.length
    ? (keywordChecks.reduce((acc, r) => acc + (r.keyword_score || 0), 0) / keywordChecks.length)
    : 1;

  const overallAccuracy = results.reduce((acc, r) => acc + r.score, 0) / total;

  const summary: GoldenSetSummary = {
    run_id: runId,
    total: results.length,
    intent_accuracy: Number(intentAccuracy.toFixed(3)),
    keyword_accuracy: Number(keywordAccuracy.toFixed(3)),
    overall_accuracy: Number(overallAccuracy.toFixed(3)),
    thresholds: {
      overall: THRESHOLD_OVERALL,
      intent: THRESHOLD_INTENT,
      keyword: THRESHOLD_KEYWORD,
      regression_delta: REGRESSION_DELTA,
    },
    status: {
      overall_pass: overallAccuracy >= THRESHOLD_OVERALL,
      intent_pass: intentAccuracy >= THRESHOLD_INTENT,
      keyword_pass: keywordAccuracy >= THRESHOLD_KEYWORD,
      regression_detected: false,
    },
    started_at: startedAt,
    completed_at: new Date().toISOString(),
    results,
  };

  history.unshift(summary);
  if (history.length > 1) {
    const previous = history[1];
    const regression = previous && (previous.overall_accuracy - summary.overall_accuracy) >= REGRESSION_DELTA;
    summary.status.regression_detected = !!regression;
  }
  if (history.length > MAX_HISTORY) {
    history.splice(MAX_HISTORY);
  }

  logger.info('Golden set evaluation completed', {
    runId,
    total: summary.total,
    overallAccuracy: summary.overall_accuracy,
  });

  return summary;
}

export function getGoldenSetSummary(): { latest: GoldenSetSummary | null; history: GoldenSetSummary[] } {
  return {
    latest: history[0] || null,
    history,
  };
}
