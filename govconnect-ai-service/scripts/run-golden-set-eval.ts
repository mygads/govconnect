import fs from 'fs';
import path from 'path';

const AI_SERVICE_URL = process.env.AI_SERVICE_URL || 'http://localhost:3002';
const INTERNAL_API_KEY = process.env.INTERNAL_API_KEY;
const BATCH_SIZE = Number(process.env.GOLDEN_SET_BATCH_SIZE || '20');

const goldenSetPath = path.join(__dirname, 'golden-set.json');

type EvalSummary = {
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
  results: Array<{
    scenario?: string;
    score: number;
    intent_match?: boolean;
    tool_score?: number;
    keyword_score?: number;
  }>;
};

function chunk<T>(items: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    chunks.push(items.slice(i, i + size));
  }
  return chunks;
}

async function runBatch(items: unknown[]): Promise<EvalSummary> {
  const response = await fetch(`${AI_SERVICE_URL}/stats/golden-set/run`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-internal-api-key': INTERNAL_API_KEY!,
    },
    body: JSON.stringify({ items }),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Failed to run golden set evaluation: ${text}`);
  }

  return await response.json() as EvalSummary;
}

function average(values: number[]): number {
  if (values.length === 0) return 1;
  return values.reduce((acc, value) => acc + value, 0) / values.length;
}

function mergeSummaries(summaries: EvalSummary[]): EvalSummary {
  const first = summaries[0];
  const results = summaries.flatMap((summary) => summary.results);
  const total = results.length || 1;
  const intentChecks = results.filter((result) => typeof result.intent_match === 'boolean');
  const toolChecks = results.filter((result) => typeof result.tool_score === 'number');
  const keywordChecks = results.filter((result) => typeof result.keyword_score === 'number');
  const grouped = new Map<string, typeof results>();

  for (const result of results) {
    const key = result.scenario || 'general';
    if (!grouped.has(key)) grouped.set(key, []);
    grouped.get(key)!.push(result);
  }

  const slices: EvalSummary['status']['slices'] = {};
  for (const [scenario, items] of grouped) {
    const scenarioIntentChecks = items.filter((item) => typeof item.intent_match === 'boolean');
    const scenarioToolChecks = items.filter((item) => typeof item.tool_score === 'number');
    slices[scenario] = {
      total: items.length,
      overall_accuracy: Number(average(items.map((item) => item.score)).toFixed(3)),
      intent_accuracy: Number(average(scenarioIntentChecks.map((item) => item.intent_match ? 1 : 0)).toFixed(3)),
      tool_accuracy: Number(average(scenarioToolChecks.map((item) => item.tool_score || 0)).toFixed(3)),
    };
  }

  const intentAccuracy = average(intentChecks.map((result) => result.intent_match ? 1 : 0));
  const toolAccuracy = average(toolChecks.map((result) => result.tool_score || 0));
  const keywordAccuracy = average(keywordChecks.map((result) => result.keyword_score || 0));
  const overallAccuracy = average(results.map((result) => result.score));

  return {
    run_id: `golden-merged-${Date.now()}`,
    total,
    intent_accuracy: Number(intentAccuracy.toFixed(3)),
    tool_accuracy: Number(toolAccuracy.toFixed(3)),
    keyword_accuracy: Number(keywordAccuracy.toFixed(3)),
    overall_accuracy: Number(overallAccuracy.toFixed(3)),
    thresholds: first.thresholds,
    status: {
      overall_pass: overallAccuracy >= first.thresholds.overall,
      intent_pass: intentAccuracy >= first.thresholds.intent,
      tool_pass: toolAccuracy >= first.thresholds.tool,
      keyword_pass: keywordAccuracy >= first.thresholds.keyword,
      regression_detected: false,
      slices,
    },
    started_at: summaries[0].started_at,
    completed_at: summaries[summaries.length - 1].completed_at,
    results,
  };
}

async function main() {
  if (!INTERNAL_API_KEY) {
    throw new Error('INTERNAL_API_KEY environment variable is required');
  }

  const raw = fs.readFileSync(goldenSetPath, 'utf-8');
  const items = JSON.parse(raw);
  const batches = chunk(items, BATCH_SIZE);
  const summaries: EvalSummary[] = [];

  for (let i = 0; i < batches.length; i += 1) {
    console.error(`Running golden-set batch ${i + 1}/${batches.length} (${batches[i].length} items)`);
    summaries.push(await runBatch(batches[i]));
  }

  const result = summaries.length === 1 ? summaries[0] : mergeSummaries(summaries);
  console.log('✅ Golden set evaluation result');
  console.log(JSON.stringify(result, null, 2));

  if (!result.status.overall_pass || !result.status.intent_pass || !result.status.tool_pass || !result.status.keyword_pass) {
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error('❌ Golden set evaluation failed');
  console.error(error.message || error);
  process.exit(1);
});
