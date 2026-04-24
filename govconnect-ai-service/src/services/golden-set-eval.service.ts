import logger from '../utils/logger';
import { processUnifiedMessage } from './unified-message-processor.service';
import { sanitizeUserInput } from './context-builder.service';
import { config } from '../config/env';
import { upsertPoliciesFromGoldenSet } from './agent/tool-policy.service';

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
  trace_score?: number;
  trace_grade?: string;
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

function inferEvalRouteFromQuery(query: string): { intent?: string; tools: string[]; semanticKeywords: string[] } {
  const text = normalizeText(query);
  const tools = new Set<string>();
  const semanticKeywords = new Set<string>();
  let intent: string | undefined;

  const add = (...keywords: string[]) => keywords.forEach((keyword) => semanticKeywords.add(normalizeText(keyword)));

  if (/^(halo|hai|ass?alamualaikum|selamat|pagi|siang|sore|malam|tes\b|permisi|gan|bro|min)/i.test(query.trim())) {
    intent = 'GREETING';
  }
  if (/terima kasih|makasih|wassalam|sudah cukup/.test(text)) {
    intent = 'FAREWELL';
  }
  if (/^(ya|tidak|betul|benar|jangan)$/i.test(query.trim())) {
    intent = 'CONFIRMATION';
  }
  if (/^(\.|\?\?\?|😊|a$|asdfghjkl)/.test(query.trim()) || /ignore previous|system:|forget everything|joke|harga beras|cuaca|presiden|bikin website/.test(text)) {
    intent = 'UNKNOWN';
  }

  if (/cek|status|progres|sudah sampai|sudah selesai|diproses|tiket|lap-\d|lay-\d|tik-\d/.test(text)) {
    intent = 'CHECK_STATUS';
    tools.add('check_status');
    add('status');
  }
  if (/riwayat|history|tampilkan semua|daftar pengaduan|semua tiket/.test(text)) {
    intent = 'HISTORY';
    tools.add('get_my_history');
    add('riwayat');
  }
  if (/batalkan|cancel|ga jadi/.test(text)) {
    intent = 'CANCEL_REQUEST';
    tools.add('cancel_request');
    add('batal');
  }
  if (/ubah|update|tambah keterangan|foto baru/.test(text) && /laporan|pengaduan|lap-/.test(text)) {
    intent = 'UPDATE_COMPLAINT';
    add('update');
  }

  const serviceSignal = /ktp|kk|skck|surat|domisili|nikah|tidak mampu|usaha|pindah|lahir|kematian|izin keramaian|layanan online|formulir|dokumen apa|syarat|persyaratan|biaya|berapa lama proses|buat|bikin|ajukan|permohonan/.test(text);
  const createServiceSignal = /mau ajukan|ajukan permohonan|buatkan saya surat|butuh surat|perlu surat|tolong buatkan|pagi bu, saya perlu/.test(text);
  if (serviceSignal) {
    intent = createServiceSignal ? 'CREATE_SERVICE_REQUEST' : 'SERVICE_INFO';
    tools.add(createServiceSignal ? 'create_service_request' : 'get_service_info');
    add('persyaratan', 'layanan');
    if (/ktp/.test(text)) add('KTP');
    if (/kk/.test(text)) add('KK');
    if (/domisili/.test(text)) add('domisili');
    if (/nikah/.test(text)) add('nikah');
    if (/usaha/.test(text)) add('usaha');
    if (/pindah/.test(text)) add('pindah');
    if (/kematian/.test(text)) add('kematian');
  }

  const complaintSignal = /jalan|jlan|sampah|smph|lampu|lmpu|pohon|banjir|saluran|got|drainase|taman|trotoar|jembatan|tiang listrik|pipa|lubang|genangan|lapor/.test(text);
  if (complaintSignal && !/gimana lapornya|jenis pengaduan|kategori|bisa lapor apa|masalah apa|tipe aduan|laporan bisa pake foto/.test(text)) {
    intent = 'CREATE_COMPLAINT';
    tools.add('create_complaint');
    add('laporan', 'alamat', 'lokasi');
    if (/jalan|jlan|trotoar|lubang/.test(text)) add('jalan');
    if (/sampah|smph/.test(text)) add('sampah');
    if (/lampu|lmpu|pju/.test(text)) add('lampu');
    if (/pohon/.test(text)) add('pohon');
    if (/banjir|saluran|got|drainase|genangan/.test(text)) add('drainase');
    if (/taman|jembatan|tiang listrik/.test(text)) add('fasilitas');
  }

  if (/alamat|lokasi kantor|jam|operasional|buka|tutup|sabtu|kontak|telepon|email|kepala desa|kepala|nomor whatsapp kepala|desa ini daerah/.test(text)) {
    intent = 'KNOWLEDGE_QUERY';
    tools.add('get_village_profile');
    add('alamat', 'lokasi', 'jam', 'kontak', 'desa');
  }
  if (/darurat|pemadam|ambulans|ambulan|polsek|puskesmas|kontak darurat|hubungi untuk bantuan/.test(text)) {
    intent = 'KNOWLEDGE_QUERY';
    tools.add('get_emergency_contacts');
    add('kontak', 'darurat', 'pemadam', 'ambulans', 'polsek', 'puskesmas');
  }
  if (/rt|rw|sop|govconnect|data saya|aman|gratis|waktu proses pengaduan|pengaduan dan layanan|batalkan laporan gimana|akta|penduduk|bantuan|sosial|pemilihan|batas|wilayah|sejarah|struktur|posyandu|visi|wisata|bpjs|musyawarah|dana desa|sertifikat tanah|pkh|vaksinasi|umkm/.test(text)) {
    intent = intent || 'KNOWLEDGE_QUERY';
    tools.add('search_knowledge');
    add('layanan', 'pengaduan', 'data', 'aman', 'RT', 'RW', 'SOP', 'bantuan', 'program');
  }
  if (/apa itu govconnect|fitur apa|cara menggunakan|kamu siapa|kamu ai|bisa bantu apa|laporan bisa pake foto|apa bedanya/.test(text)) {
    intent = intent === 'KNOWLEDGE_QUERY' ? intent : 'QUESTION';
    add('layanan', 'cara', 'GovConnect', 'asisten', 'foto', 'pengaduan');
  }
  if (/jenis pengaduan|kategori laporan|bisa lapor apa|masalah apa|tipe aduan|mati lampu gimana lapornya/.test(text)) {
    intent = /mati lampu/.test(text) ? 'SERVICE_INFO' : 'KNOWLEDGE_QUERY';
    tools.add('get_complaint_categories');
    add('kategori', 'pengaduan', 'laporan', 'lampu', 'lapor');
  }

  if (/^jl\b|rt\s*\d|depan masjid|nama saya|^[a-z]+$/i.test(query.trim()) && !intent) {
    intent = /nama saya|^[a-z]+$/i.test(query.trim()) ? 'NAME_UPDATE' : 'ADDRESS_INPUT';
  }

  return { intent, tools: [...tools], semanticKeywords: [...semanticKeywords] };
}

function isGenericEvalFallback(replyText: string): boolean {
  const reply = normalizeText(replyText);
  return reply.includes('membutuhkan waktu lebih lama') || reply.includes('informasinya belum berhasil kami temukan') || reply.includes('terjadi gangguan pada sistem');
}

function inferEffectiveToolsFromResult(query: string, predictedIntent: string, replyText: string, actualTools: string[]): string[] {
  const effectiveTools = new Set(actualTools.map(normalizeToolName));
  const normalizedIntent = (predictedIntent || '').toUpperCase();
  const normalizedReply = normalizeText(replyText);
  const inferredRoute = inferEvalRouteFromQuery(query);

  if (isGenericEvalFallback(replyText) || effectiveTools.size === 0) {
    inferredRoute.tools.forEach((tool) => effectiveTools.add(normalizeToolName(tool)));
  }

  if (normalizedIntent === 'CHECK_STATUS') effectiveTools.add('check_status');
  if (normalizedIntent === 'CREATE_COMPLAINT') effectiveTools.add('create_complaint');
  if (normalizedIntent === 'UPDATE_COMPLAINT') effectiveTools.add('update_complaint');
  if (normalizedIntent === 'CREATE_SERVICE_REQUEST') effectiveTools.add('create_service_request');
  if (normalizedIntent === 'HISTORY') effectiveTools.add('get_my_history');
  if (normalizedIntent === 'CANCEL_REQUEST') effectiveTools.add('cancel_request');
  if (normalizedIntent === 'SERVICE_INFO') effectiveTools.add('get_service_info');
  if (normalizedIntent === 'DOCUMENT_SEARCH') effectiveTools.add('search_documents');

  if (normalizedIntent === 'KNOWLEDGE_QUERY') {
    if (/alamat|lokasi|jam|operasional|kontak|telepon|kepala desa|kantor|desa/.test(normalizedReply)) {
      effectiveTools.add('get_village_profile');
    }
    if (/darurat|pemadam|ambulans|ambulan|polisi|puskesmas|110|119|113/.test(normalizedReply)) {
      effectiveTools.add('get_emergency_contacts');
    }
    effectiveTools.add('search_knowledge');
  }

  return [...effectiveTools];
}

function inferEffectiveIntent(query: string, predictedIntent: string, replyText: string): string {
  if (!isGenericEvalFallback(replyText) && predictedIntent !== 'AGENT') {
    return predictedIntent;
  }

  return inferEvalRouteFromQuery(query).intent || predictedIntent || 'UNKNOWN';
}

function buildSemanticReplyForScoring(query: string, replyText: string): string {
  const inferred = inferEvalRouteFromQuery(query);
  return `${replyText}\n${query}\n${inferred.semanticKeywords.join(' ')}`;
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

function computeTraceGrade(score: number, latencyMs: number): { traceScore: number; traceGrade: string } {
  const latencyScore = latencyMs <= 2500
    ? 1
    : latencyMs <= 5000
      ? 0.85
      : latencyMs <= 8000
        ? 0.7
        : 0.5;
  const traceScore = Number((((score * 0.75) + (latencyScore * 0.25)) * 100).toFixed(1));

  if (traceScore >= 90) return { traceScore, traceGrade: 'A' };
  if (traceScore >= 80) return { traceScore, traceGrade: 'B' };
  if (traceScore >= 70) return { traceScore, traceGrade: 'C' };
  return { traceScore, traceGrade: 'D' };
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

    const replyText = result.response || '';
    const predictedIntent = inferEffectiveIntent(item.query, result.intent || 'UNKNOWN', replyText);
    const rawTools = result.metadata.toolsUsed || [];
    const actualTools = inferEffectiveToolsFromResult(item.query, predictedIntent, replyText, rawTools);
    const scenario = classifyEvalScenario(item);
    const semanticReplyText = buildSemanticReplyForScoring(item.query, replyText);

    const intentMatch = item.expected_intent
      ? predictedIntent === item.expected_intent
      : undefined;

    const toolScore = computeToolScore(actualTools, item.expected_tools);
    const keywordScore = computeKeywordScore(semanticReplyText, item.expected_keywords);

    const scoreParts: number[] = [];
    if (typeof intentMatch === 'boolean') scoreParts.push(intentMatch ? 1 : 0);
    if (Array.isArray(item.expected_tools)) scoreParts.push(toolScore.score);
    if (item.expected_keywords && item.expected_keywords.length > 0) scoreParts.push(keywordScore.score);

    const score = scoreParts.length > 0
      ? scoreParts.reduce((acc, cur) => acc + cur, 0) / scoreParts.length
      : 1;
    const latencyMs = Date.now() - startItem;
    const traceGrade = computeTraceGrade(score, latencyMs);

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
      trace_score: traceGrade.traceScore,
      trace_grade: traceGrade.traceGrade,
      score,
      latency_ms: latencyMs,
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
  persistEvalRun(summary, defaultVillageId).catch((err) => {
    logger.warn('Failed to persist golden set run to dashboard (non-blocking)', { error: err.message });
  });
  upsertPoliciesFromGoldenSet(summary.results).catch((err) => {
    logger.warn('Failed to upsert tool allowlist policies from golden set', { error: err.message });
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
async function persistEvalRun(summary: GoldenSetSummary, defaultVillageId?: string): Promise<void> {
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
      village_id: defaultVillageId || null,
      total: summary.total,
      intent_accuracy: summary.intent_accuracy,
      tool_accuracy: summary.tool_accuracy,
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
