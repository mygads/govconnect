import logger from '../utils/logger';
import { processUnifiedMessage } from './unified-message-processor.service';
import { sanitizeUserInput } from './context-builder.service';
import { config } from '../config/env';

export type GoldenSetItem = {
  id: string;
  query: string;
  expected_intent?: string;
  expected_tools?: string[];
  expected_keywords?: string[];
  village_id?: string;
  note?: string;
};

export type GoldenSetItemResult = {
  id: string;
  query: string;
  expected_intent?: string;
  expected_tools?: string[];
  predicted_intent: string;
  actual_tools?: string[];
  reply_text: string;
  intent_match?: boolean;
  tool_match?: boolean;
  tool_score?: number;
  keyword_match?: boolean;
  keyword_score?: number;
  score: number;
  latency_ms: number;
  scenario?: string;
  trace_id?: string;
};

export type GoldenSetSummary = {
  run_id: string;
  total: number;
  intent_accuracy: number;
  tool_accuracy: number;
  keyword_accuracy: number;
  overall_accuracy: number;
  thresholds: {
    overall: number;
    intent: number;
    tool: number;
    keyword: number;
    regression_delta: number;
  };
  status: {
    overall_pass: boolean;
    intent_pass: boolean;
    tool_pass: boolean;
    keyword_pass: boolean;
    regression_detected: boolean;
    slices?: Record<string, {
      total: number;
      overall_accuracy: number;
      intent_accuracy: number;
      tool_accuracy: number;
    }>;
  };
  started_at: string;
  completed_at: string;
  results: GoldenSetItemResult[];
};

const history: GoldenSetSummary[] = [];
const MAX_HISTORY = 10;
const THRESHOLD_OVERALL = parseFloat(process.env.GOLDEN_SET_THRESHOLD_OVERALL || '0.75');
const THRESHOLD_INTENT = parseFloat(process.env.GOLDEN_SET_THRESHOLD_INTENT || '0.75');
const THRESHOLD_TOOL = parseFloat(process.env.GOLDEN_SET_THRESHOLD_TOOL || '0.8');
const THRESHOLD_KEYWORD = parseFloat(process.env.GOLDEN_SET_THRESHOLD_KEYWORD || '0.7');
const REGRESSION_DELTA = parseFloat(process.env.GOLDEN_SET_REGRESSION_DELTA || '0.05');

function normalizeText(text: string): string {
  return (text || '').toLowerCase();
}

function normalizeToolName(tool: string): string {
  switch (tool) {
    case 'get_office_profile':
    case 'get_village_profile':
      return 'get_village_profile';
    case 'get_service_catalog':
    case 'get_service_requirements':
    case 'get_service_info':
      return 'get_service_info';
    case 'get_important_contacts':
    case 'get_emergency_contacts':
      return 'get_emergency_contacts';
    case 'check_complaint_status':
    case 'check_service_request_status':
    case 'check_status':
      return 'check_status';
    case 'cancel_complaint':
    case 'cancel_service_request':
    case 'cancel_request':
      return 'cancel_request';
    default:
      return tool;
  }
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

function computeToolScore(actualTools: string[], expectedTools?: string[]): { match: boolean; score: number } {
  if (!expectedTools) {
    return { match: true, score: 1 };
  }

  const normalizedActualTools = [...new Set(actualTools.map(normalizeToolName))];
  const normalizedExpectedTools = [...new Set(expectedTools.map(normalizeToolName))];

  if (expectedTools.length === 0) {
    return {
      match: normalizedActualTools.length === 0,
      score: normalizedActualTools.length === 0 ? 1 : 0,
    };
  }

  const matched = normalizedExpectedTools.filter((tool) => normalizedActualTools.includes(tool));
  const score = matched.length / normalizedExpectedTools.length;
  return {
    match: score >= 1,
    score,
  };
}

function normalizeScenarioLabel(label: string): string {
  return label
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '') || 'general';
}

function classifyEvalScenario(item: GoldenSetItem): string {
  if (item.note) {
    return normalizeScenarioLabel(item.note);
  }

  const expectedTools = (item.expected_tools || []).map(normalizeToolName);
  if (expectedTools.includes('get_village_profile') || expectedTools.includes('get_emergency_contacts')) {
    return 'fact_query';
  }
  if (expectedTools.includes('search_documents')) {
    return 'document_query';
  }
  if (expectedTools.includes('search_knowledge')) {
    return 'knowledge_query';
  }
  if (expectedTools.includes('get_service_info')) {
    return 'service_query';
  }
  if (expectedTools.includes('create_complaint')) {
    return 'complaint_flow';
  }
  if (expectedTools.includes('check_status')) {
    return 'status_query';
  }

  const wordCount = item.query.trim().split(/\s+/).filter(Boolean).length;
  if (wordCount <= 2) {
    return 'short_query';
  }

  return 'general';
}

function buildSliceSummary(results: GoldenSetItemResult[]): Record<string, {
  total: number;
  overall_accuracy: number;
  intent_accuracy: number;
  tool_accuracy: number;
}> {
  const grouped = new Map<string, GoldenSetItemResult[]>();

  for (const result of results) {
    const key = result.scenario || 'general';
    if (!grouped.has(key)) grouped.set(key, []);
    grouped.get(key)!.push(result);
  }

  const summary: Record<string, {
    total: number;
    overall_accuracy: number;
    intent_accuracy: number;
    tool_accuracy: number;
  }> = {};

  for (const [scenario, items] of grouped) {
    const total = items.length || 1;
    const intentChecks = items.filter((item) => typeof item.intent_match === 'boolean');
    const toolChecks = items.filter((item) => typeof item.tool_score === 'number');

    summary[scenario] = {
      total: items.length,
      overall_accuracy: Number((items.reduce((acc, item) => acc + item.score, 0) / total).toFixed(3)),
      intent_accuracy: Number((intentChecks.length
        ? intentChecks.filter((item) => item.intent_match).length / intentChecks.length
        : 1).toFixed(3)),
      tool_accuracy: Number((toolChecks.length
        ? toolChecks.reduce((acc, item) => acc + (item.tool_score || 0), 0) / toolChecks.length
        : 1).toFixed(3)),
    };
  }

  return summary;
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
    const actualTools = result.metadata.toolsUsed || [];
    const scenario = classifyEvalScenario(item);

    const intentMatch = item.expected_intent
      ? predictedIntent === item.expected_intent
      : undefined;

    const toolScore = computeToolScore(actualTools, item.expected_tools);
    const keywordScore = computeKeywordScore(replyText, item.expected_keywords);

    const scoreParts: number[] = [];
    if (typeof intentMatch === 'boolean') scoreParts.push(intentMatch ? 1 : 0);
    if (Array.isArray(item.expected_tools)) scoreParts.push(toolScore.score);
    if (item.expected_keywords && item.expected_keywords.length > 0) scoreParts.push(keywordScore.score);

    const score = scoreParts.length > 0
      ? scoreParts.reduce((acc, cur) => acc + cur, 0) / scoreParts.length
      : 1;

    results.push({
      id: item.id,
      query: item.query,
      expected_intent: item.expected_intent,
      expected_tools: item.expected_tools,
      predicted_intent: predictedIntent,
      actual_tools: actualTools,
      reply_text: replyText,
      intent_match: intentMatch,
      tool_match: Array.isArray(item.expected_tools) ? toolScore.match : undefined,
      tool_score: Array.isArray(item.expected_tools) ? toolScore.score : undefined,
      keyword_match: item.expected_keywords ? keywordScore.match : undefined,
      keyword_score: item.expected_keywords ? keywordScore.score : undefined,
      score,
      latency_ms: Date.now() - startItem,
      scenario,
      trace_id: result.metadata.traceId,
    });
  }

  const total = results.length || 1;
  const intentChecks = results.filter(r => typeof r.intent_match === 'boolean');
  const toolChecks = results.filter(r => typeof r.tool_score === 'number');
  const keywordChecks = results.filter(r => typeof r.keyword_score === 'number');

  const intentAccuracy = intentChecks.length
    ? (intentChecks.filter(r => r.intent_match).length / intentChecks.length)
    : 1;

  const keywordAccuracy = keywordChecks.length
    ? (keywordChecks.reduce((acc, r) => acc + (r.keyword_score || 0), 0) / keywordChecks.length)
    : 1;
  const toolAccuracy = toolChecks.length
    ? (toolChecks.reduce((acc, r) => acc + (r.tool_score || 0), 0) / toolChecks.length)
    : 1;

  const overallAccuracy = results.reduce((acc, r) => acc + r.score, 0) / total;
  const slices = buildSliceSummary(results);

  const summary: GoldenSetSummary = {
    run_id: runId,
    total: results.length,
    intent_accuracy: Number(intentAccuracy.toFixed(3)),
    tool_accuracy: Number(toolAccuracy.toFixed(3)),
    keyword_accuracy: Number(keywordAccuracy.toFixed(3)),
    overall_accuracy: Number(overallAccuracy.toFixed(3)),
    thresholds: {
      overall: THRESHOLD_OVERALL,
      intent: THRESHOLD_INTENT,
      tool: THRESHOLD_TOOL,
      keyword: THRESHOLD_KEYWORD,
      regression_delta: REGRESSION_DELTA,
    },
    status: {
      overall_pass: overallAccuracy >= THRESHOLD_OVERALL,
      intent_pass: intentAccuracy >= THRESHOLD_INTENT,
      tool_pass: toolAccuracy >= THRESHOLD_TOOL,
      keyword_pass: keywordAccuracy >= THRESHOLD_KEYWORD,
      regression_detected: false,
      slices,
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

  // Persist to dashboard DB (fire-and-forget)
  persistEvalRun(summary).catch((err) => {
    logger.warn('Failed to persist golden set run to dashboard (non-blocking)', { error: err.message });
  });

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

/**
 * Persist evaluation run to dashboard DB via API
 */
async function persistEvalRun(summary: GoldenSetSummary): Promise<void> {
  const dashboardUrl = process.env.DASHBOARD_SERVICE_URL || process.env.DASHBOARD_URL || '';
  if (!dashboardUrl) {
    logger.debug('DASHBOARD_SERVICE_URL not configured, skipping eval persistence');
    return;
  }

  const response = await fetch(`${dashboardUrl}/api/golden-set`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-internal-api-key': config.internalApiKey,
    },
    body: JSON.stringify({
      run_id: summary.run_id,
      total: summary.total,
      intent_accuracy: summary.intent_accuracy,
      keyword_accuracy: summary.keyword_accuracy,
      overall_accuracy: summary.overall_accuracy,
      thresholds: summary.thresholds,
      status: summary.status,
      started_at: summary.started_at,
      completed_at: summary.completed_at,
      results: summary.results,
    }),
  });

  if (!response.ok) {
    throw new Error(`Dashboard API returned ${response.status}`);
  }

  const data: any = await response.json();

  if (data.data?.regression_detected) {
    logger.warn('⚠️ REGRESSION DETECTED in golden set evaluation — release gate may fail', {
      runId: summary.run_id,
      overallAccuracy: summary.overall_accuracy,
    });
  }

  if (!data.data?.release_gate_pass) {
    logger.warn('🚫 RELEASE GATE FAILED — golden set accuracy below threshold', {
      runId: summary.run_id,
      overallAccuracy: summary.overall_accuracy,
    });
  }

  logger.info('Golden set run persisted to dashboard', { runId: summary.run_id });
}
