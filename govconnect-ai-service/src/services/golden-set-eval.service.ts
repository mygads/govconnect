import logger from '../utils/logger';
import { processUnifiedMessage } from './unified-message-processor.service';
import { sanitizeUserInput } from './context-builder.service';

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

export async function runGoldenSetEvaluation(items: GoldenSetItem[], defaultVillageId?: string): Promise<GoldenSetSummary> {
  const runId = `golden-${Date.now()}`;
  const startedAt = new Date().toISOString();
  const results: GoldenSetItemResult[] = [];

  for (const item of items) {
    const startItem = Date.now();
    const sanitized = sanitizeUserInput(item.query);
    const userId = `golden_eval_${item.id}`;
    const villageId = item.village_id || defaultVillageId;

    // Use unified message processor (same as production)
    const result = await processUnifiedMessage({
      userId,
      channel: 'webchat',
      message: sanitized,
      villageId,
      isEvaluation: true,
    });

    const predictedIntent = result.intent || 'UNKNOWN';
    const replyText = result.response || '';

    const intentMatch = item.expected_intent
      ? predictedIntent === item.expected_intent
      : undefined;

    const keywordScore = computeKeywordScore(replyText, item.expected_keywords);

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
      predicted_intent: predictedIntent,
      reply_text: replyText,
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
