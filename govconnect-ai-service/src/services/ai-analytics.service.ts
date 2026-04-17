/**
 * AI Analytics Service
 * 
 * Tracks and analyzes AI performance metrics:
 * - Intent classification accuracy
 * - Token usage and cost estimation
 * - Conversation flow patterns
 * - Response quality metricss
 */

import logger from '../utils/logger';
import prisma from '../lib/prisma';
import { Prisma } from '@prisma/client';
import { randomUUID } from 'crypto';
import { findPricing as getTokenPricing } from './token-usage.service';
import { registerInterval } from '../utils/timer-registry';

// Use token-usage.service as single source of truth for pricing
// Estimated tokens per character (rough estimate for Indonesian text)
const CHARS_PER_TOKEN = 3.5;

interface IntentStats {
  intent: string;
  count: number;
  successCount: number; // Resulted in successful action (complaint created, etc)
  failCount: number; // Required retry or correction
  avgProcessingTimeMs: number;
  totalProcessingTimeMs: number;
}

interface ConversationFlowStats {
  // Flow patterns: e.g., "QUESTION -> CREATE_COMPLAINT -> CHECK_STATUS"
  patterns: Record<string, number>;
  avgMessagesPerSession: number;
  totalSessions: number;
  totalMessages: number;
  dropOffPoints: Record<string, number>; // Where users stop responding
}

interface TokenUsageStats {
  totalInputTokens: number;
  totalOutputTokens: number;
  totalCostUSD: number;
  byModel: Record<string, {
    inputTokens: number;
    outputTokens: number;
    costUSD: number;
    callCount: number;
  }>;
  byDay: Record<string, {
    inputTokens: number;
    outputTokens: number;
    costUSD: number;
  }>;
}

interface AccuracyStats {
  totalClassifications: number;
  correctClassifications: number;
  overallAccuracy: number;
  byIntent: Record<string, {
    total: number;
    correct: number;
    accuracy: number;
  }>;
  confusionMatrix: Record<string, Record<string, number>>; // predicted -> actual
}

interface KnowledgeGapEntry {
  query: string;
  intent: string;
  confidence: string; // 'none' | 'low' | 'medium' | 'high'
  channel: string;
  villageId?: string;
  timestamp: string;
  count: number; // How many times this query (normalized) was asked
}

interface KnowledgeStats {
  hits: number;         // RAG confidence high/medium
  misses: number;       // RAG confidence low/none
  noKnowledge: number;  // No knowledge context at all
  /** Top unanswered queries — capped at 100 entries, deduplicated by normalized text */
  gaps: KnowledgeGapEntry[];
}

interface RetrievalTraceEntry {
  query: string;
  retrievalMode: 'rag' | 'keyword' | 'document_rag';
  confidence: 'none' | 'low' | 'medium' | 'high';
  hasKnowledge: boolean;
  resultCount: number;
  searchTimeMs: number;
  topScore: number | null;
  avgTopScore: number | null;
  sourceTitles: string[];
  candidateDebug?: Array<{
    id: string;
    title: string;
    sourceType: 'knowledge' | 'document';
    finalScore: number;
    vectorScore?: number | null;
    keywordScore?: number | null;
    vectorRank?: number | null;
    keywordRank?: number | null;
    rrfScore?: number | null;
    rerankScore?: number | null;
    matchType?: 'vector' | 'keyword' | 'both' | null;
    selected?: boolean;
  }>;
  channel: string;
  villageId?: string;
  timestamp: string;
}

interface RetrievalStats {
  recentTraces: RetrievalTraceEntry[];
}

interface CategoryUsageEntry {
  category: string;
  count: number;
  lastUsed: string;
}

interface CategoryUsageStats {
  /** Complaint categories used (e.g., "infrastruktur_jalan": 42) */
  complaint: Record<string, CategoryUsageEntry>;
  /** Knowledge categories queried (e.g., "jadwal": 15) */
  knowledge: Record<string, CategoryUsageEntry>;
  /** Service slugs requested (e.g., "ktp": 30) */
  service: Record<string, CategoryUsageEntry>;
}

interface AnalyticsStorage {
  intents: Record<string, IntentStats>;
  conversationFlow: ConversationFlowStats;
  tokenUsage: TokenUsageStats;
  accuracy: AccuracyStats;
  knowledge: KnowledgeStats;
  retrieval: RetrievalStats;
  categoryUsage: CategoryUsageStats;
  lastUpdated: string;
}

interface SessionData {
  wa_user_id: string;
  intents: string[];
  startTime: number;
  lastActivity: number;
}

const SESSION_TIMEOUT_MS = 30 * 60 * 1000; // 30 minutes

class AIAnalyticsService {
  private data: AnalyticsStorage;
  private sessions: Map<string, SessionData> = new Map();

  constructor() {
    this.data = this.getDefaultStorage();
    this.startSessionCleanup();
    logger.info('📊 AI Analytics Service initialized (hybrid durable + in-memory)');
  }

  /**
   * Get default storage structure
   */
  private getDefaultStorage(): AnalyticsStorage {
    return {
      intents: {},
      conversationFlow: {
        patterns: {},
        avgMessagesPerSession: 0,
        totalSessions: 0,
        totalMessages: 0,
        dropOffPoints: {},
      },
      tokenUsage: {
        totalInputTokens: 0,
        totalOutputTokens: 0,
        totalCostUSD: 0,
        byModel: {},
        byDay: {},
      },
      knowledge: {
        hits: 0,
        misses: 0,
        noKnowledge: 0,
        gaps: [],
      },
      retrieval: {
        recentTraces: [],
      },
      categoryUsage: {
        complaint: {},
        knowledge: {},
        service: {},
      },
      accuracy: {
        totalClassifications: 0,
        correctClassifications: 0,
        overallAccuracy: 100,
        byIntent: {},
        confusionMatrix: {},
      },
      lastUpdated: new Date().toISOString(),
    };
  }

  /**
   * Start session cleanup (every 10 minutes)
   */
  private startSessionCleanup(): void {
    registerInterval(() => {
      const now = Date.now();
      let cleaned = 0;
      
      for (const [userId, session] of this.sessions.entries()) {
        if (now - session.lastActivity > SESSION_TIMEOUT_MS) {
          // Session expired - record the flow pattern
          this.recordSessionEnd(session);
          this.sessions.delete(userId);
          cleaned++;
        }
      }
      
      if (cleaned > 0) {
        logger.debug('🧹 Cleaned expired sessions', { count: cleaned });
      }
    }, 10 * 60 * 1000, 'ai-analytics-session-cleanup');
  }

  /**
   * Record an intent classification oke
   */
  recordIntent(
    wa_user_id: string,
    intent: string,
    processingTimeMs: number,
    inputLength: number,
    outputLength: number,
    model: string
  ): void {
    // Validate processingTimeMs - should be reasonable (< 5 minutes = 300000ms)
    const validProcessingTime = processingTimeMs > 0 && processingTimeMs < 300000 
      ? processingTimeMs 
      : 3000; // Default to 3 seconds if invalid
    
    // Update intent stats
    if (!this.data.intents[intent]) {
      this.data.intents[intent] = {
        intent,
        count: 0,
        successCount: 0,
        failCount: 0,
        avgProcessingTimeMs: 0,
        totalProcessingTimeMs: 0,
      };
    }
    
    const stats = this.data.intents[intent];
    stats.count++;
    stats.totalProcessingTimeMs += validProcessingTime;
    stats.avgProcessingTimeMs = Math.round(stats.totalProcessingTimeMs / stats.count);

    // Update session tracking
    this.updateSession(wa_user_id, intent);

    // Update token usage
    this.recordTokenUsage(model, inputLength, outputLength);

    // Update accuracy tracking
    this.data.accuracy.totalClassifications++;
    if (!this.data.accuracy.byIntent[intent]) {
      this.data.accuracy.byIntent[intent] = { total: 0, correct: 0, accuracy: 0 };
    }
    this.data.accuracy.byIntent[intent].total++;
    
    // Auto-mark non-action intents as "successful" since they don't have explicit success/fail
    // Only action intents (CREATE_*, CHECK_*, CANCEL_*, HISTORY) need explicit success tracking
    const actionIntents = ['CREATE_COMPLAINT', 'SERVICE_INFO', 'CREATE_SERVICE_REQUEST', 'CHECK_STATUS', 'HISTORY'];
    if (!actionIntents.includes(intent)) {
      // Non-action intents (QUESTION, GREETING, KNOWLEDGE_QUERY, UNKNOWN) are auto-successful
      this.data.accuracy.byIntent[intent].correct++;
      this.data.accuracy.correctClassifications++;
    }
    
    // Recalculate accuracy for this intent
    const intentStats = this.data.accuracy.byIntent[intent];
    intentStats.accuracy = intentStats.total > 0 
      ? Math.round((intentStats.correct / intentStats.total) * 100) 
      : 0;
    
    // Recalculate overall accuracy
    this.data.accuracy.overallAccuracy = this.data.accuracy.totalClassifications > 0
      ? Math.round((this.data.accuracy.correctClassifications / this.data.accuracy.totalClassifications) * 100)
      : 0;
  }

  /**
   * Record successful action (complaint/service request created successfully)
   */
  recordSuccess(intent: string): void {
    if (this.data.intents[intent]) {
      this.data.intents[intent].successCount++;
    }

    // Also update accuracy
    if (this.data.accuracy.byIntent[intent]) {
      this.data.accuracy.byIntent[intent].correct++;
      this.data.accuracy.byIntent[intent].accuracy = Math.round(
        (this.data.accuracy.byIntent[intent].correct / this.data.accuracy.byIntent[intent].total) * 100
      );
    }
    this.data.accuracy.correctClassifications++;
    this.data.accuracy.overallAccuracy = Math.round(
      (this.data.accuracy.correctClassifications / this.data.accuracy.totalClassifications) * 100
    );
  }

  /**
   * Record knowledge retrieval result (hit/miss) and track gaps
   */
  recordKnowledge(opts: {
    query: string;
    intent: string;
    confidence: 'none' | 'low' | 'medium' | 'high';
    channel: string;
    villageId?: string;
    hasKnowledge: boolean;
  }): void {
    if (!opts.hasKnowledge) {
      this.data.knowledge.noKnowledge++;
    }
    if (opts.confidence === 'high' || opts.confidence === 'medium') {
      this.data.knowledge.hits++;
    } else {
      this.data.knowledge.misses++;

      // Track gap — deduplicate by normalized query text
      const normalized = opts.query.toLowerCase().replace(/[^a-z0-9\s]/gi, '').trim();
      if (normalized.length < 3) return; // skip noise

      const existing = this.data.knowledge.gaps.find(
        g => g.query.toLowerCase().replace(/[^a-z0-9\s]/gi, '').trim() === normalized
      );
      if (existing) {
        existing.count++;
        existing.timestamp = new Date().toISOString(); // update last seen
      } else {
        this.data.knowledge.gaps.push({
          query: opts.query.substring(0, 200), // cap length
          intent: opts.intent,
          confidence: opts.confidence,
          channel: opts.channel,
          villageId: opts.villageId,
          timestamp: new Date().toISOString(),
          count: 1,
        });
        // Keep max 100 gap entries, sorted by count desc
        if (this.data.knowledge.gaps.length > 100) {
          this.data.knowledge.gaps.sort((a, b) => b.count - a.count);
          this.data.knowledge.gaps = this.data.knowledge.gaps.slice(0, 100);
        }
      }
    }
  }

  recordRetrievalTrace(opts: {
    traceId?: string;
    waUserId?: string;
    query: string;
    retrievalMode: 'rag' | 'keyword' | 'document_rag';
    confidence: 'none' | 'low' | 'medium' | 'high';
    hasKnowledge: boolean;
    resultCount: number;
    searchTimeMs?: number;
    topScore?: number | null;
    avgTopScore?: number | null;
    sourceTitles?: string[];
    candidateDebug?: RetrievalTraceEntry['candidateDebug'];
    channel: string;
    villageId?: string;
  }): void {
    const query = opts.query.trim();
    if (!query) return;

    const trace: RetrievalTraceEntry = {
      query: query.substring(0, 200),
      retrievalMode: opts.retrievalMode,
      confidence: opts.confidence,
      hasKnowledge: opts.hasKnowledge,
      resultCount: Math.max(0, opts.resultCount || 0),
      searchTimeMs: Math.max(0, Math.round(opts.searchTimeMs || 0)),
      topScore: typeof opts.topScore === 'number' ? Math.round(opts.topScore * 1000) / 1000 : null,
      avgTopScore: typeof opts.avgTopScore === 'number' ? Math.round(opts.avgTopScore * 1000) / 1000 : null,
      sourceTitles: Array.from(new Set((opts.sourceTitles || []).filter(Boolean))).slice(0, 3),
      candidateDebug: Array.isArray(opts.candidateDebug) ? opts.candidateDebug.slice(0, 10) : undefined,
      channel: opts.channel,
      villageId: opts.villageId,
      timestamp: new Date().toISOString(),
    };

    this.data.retrieval.recentTraces.unshift(trace);
    if (this.data.retrieval.recentTraces.length > 250) {
      this.data.retrieval.recentTraces = this.data.retrieval.recentTraces.slice(0, 250);
    }

    void this.persistRetrievalTrace({
      traceId: opts.traceId,
      waUserId: opts.waUserId,
      ...trace,
    });
  }

  /**
   * Get knowledge analytics stats
   */
  getKnowledgeStats(): {
    hits: number;
    misses: number;
    noKnowledge: number;
    hitRate: number;
    missRate: number;
    topGaps: KnowledgeGapEntry[];
  } {
    const total = this.data.knowledge.hits + this.data.knowledge.misses;
    return {
      hits: this.data.knowledge.hits,
      misses: this.data.knowledge.misses,
      noKnowledge: this.data.knowledge.noKnowledge,
      hitRate: total > 0 ? Math.round((this.data.knowledge.hits / total) * 100 * 10) / 10 : 0,
      missRate: total > 0 ? Math.round((this.data.knowledge.misses / total) * 100 * 10) / 10 : 0,
      topGaps: [...this.data.knowledge.gaps].sort((a, b) => b.count - a.count).slice(0, 20),
    };
  }

  getRetrievalObservability(filters?: {
    villageId?: string;
    channel?: string;
  }): {
    summary: {
      totalTraces: number;
      hitRate: number;
      avgLatencyMs: number;
      p95LatencyMs: number;
      avgResultCount: number;
      avgTopScore: number | null;
    };
    byMode: Array<{
      mode: string;
      count: number;
      hitRate: number;
      avgLatencyMs: number;
      avgResultCount: number;
    }>;
    byConfidence: Array<{
      confidence: string;
      count: number;
      percentage: number;
    }>;
    recentTraces: RetrievalTraceEntry[];
  } {
    const traces = this.data.retrieval.recentTraces.filter((trace) => {
      if (filters?.villageId && trace.villageId !== filters.villageId) {
        return false;
      }
      if (filters?.channel && trace.channel !== filters.channel) {
        return false;
      }
      return true;
    });
    const totalTraces = traces.length;

    const hitCount = traces.filter((trace) => trace.hasKnowledge).length;
    const latencies = traces
      .map((trace) => trace.searchTimeMs)
      .filter((value) => Number.isFinite(value) && value >= 0)
      .sort((a, b) => a - b);
    const resultCounts = traces.map((trace) => trace.resultCount);
    const scored = traces
      .map((trace) => trace.topScore)
      .filter((score): score is number => typeof score === 'number' && Number.isFinite(score));

    const byMode = Array.from(
      traces.reduce((acc, trace) => {
        const bucket = acc.get(trace.retrievalMode) || {
          mode: trace.retrievalMode,
          count: 0,
          hitCount: 0,
          totalLatencyMs: 0,
          totalResultCount: 0,
        };

        bucket.count++;
        bucket.hitCount += trace.hasKnowledge ? 1 : 0;
        bucket.totalLatencyMs += trace.searchTimeMs;
        bucket.totalResultCount += trace.resultCount;
        acc.set(trace.retrievalMode, bucket);
        return acc;
      }, new Map<string, {
        mode: string;
        count: number;
        hitCount: number;
        totalLatencyMs: number;
        totalResultCount: number;
      }>())
    )
      .map(([, bucket]) => ({
        mode: bucket.mode,
        count: bucket.count,
        hitRate: bucket.count > 0 ? Math.round((bucket.hitCount / bucket.count) * 1000) / 10 : 0,
        avgLatencyMs: bucket.count > 0 ? Math.round(bucket.totalLatencyMs / bucket.count) : 0,
        avgResultCount: bucket.count > 0 ? Math.round((bucket.totalResultCount / bucket.count) * 10) / 10 : 0,
      }))
      .sort((a, b) => b.count - a.count);

    const byConfidence = Array.from(
      traces.reduce((acc, trace) => {
        acc.set(trace.confidence, (acc.get(trace.confidence) || 0) + 1);
        return acc;
      }, new Map<string, number>())
    )
      .map(([confidence, count]) => ({
        confidence,
        count,
        percentage: totalTraces > 0 ? Math.round((count / totalTraces) * 1000) / 10 : 0,
      }))
      .sort((a, b) => b.count - a.count);

    const p95LatencyMs = latencies.length > 0
      ? latencies[Math.min(latencies.length - 1, Math.max(0, Math.ceil(latencies.length * 0.95) - 1))]
      : 0;

    return {
      summary: {
        totalTraces,
        hitRate: totalTraces > 0 ? Math.round((hitCount / totalTraces) * 1000) / 10 : 0,
        avgLatencyMs: latencies.length > 0
          ? Math.round(latencies.reduce((sum, value) => sum + value, 0) / latencies.length)
          : 0,
        p95LatencyMs,
        avgResultCount: resultCounts.length > 0
          ? Math.round((resultCounts.reduce((sum, value) => sum + value, 0) / resultCounts.length) * 10) / 10
          : 0,
        avgTopScore: scored.length > 0
          ? Math.round((scored.reduce((sum, value) => sum + value, 0) / scored.length) * 1000) / 1000
          : null,
      },
      byMode,
      byConfidence,
      recentTraces: traces.slice(0, 50),
    };
  }

  async recordInteractionEvent(opts: {
    waUserId: string;
    villageId?: string;
    channel?: string;
    intent: string;
    success: boolean;
    hasKnowledge: boolean;
    isFallback: boolean;
    agentMode?: string;
    responseSource?: string;
    toolsUsed?: string[];
    model?: string;
    processingTimeMs?: number;
  }): Promise<void> {
    try {
      const latestRows = await prisma.$queryRaw<Array<{
        analytics_session_id: string;
        created_at: Date;
      }>>(Prisma.sql`
        SELECT analytics_session_id, created_at
        FROM ai_interaction_events
        WHERE wa_user_id = ${opts.waUserId}
        ${opts.villageId ? Prisma.sql`AND village_id = ${opts.villageId}` : Prisma.empty}
        ${opts.channel ? Prisma.sql`AND channel = ${opts.channel}` : Prisma.empty}
        ORDER BY created_at DESC
        LIMIT 1
      `);
      const latest = latestRows[0];

      const now = Date.now();
      const analyticsSessionId = latest && now - latest.created_at.getTime() <= SESSION_TIMEOUT_MS
        ? latest.analytics_session_id
        : `sess_${now.toString(36)}_${Math.random().toString(36).slice(2, 8)}`;

      const toolsUsedJson = Array.isArray(opts.toolsUsed)
        ? Prisma.sql`${JSON.stringify(opts.toolsUsed)}::jsonb`
        : Prisma.sql`NULL`;

      await prisma.$executeRaw(Prisma.sql`
        INSERT INTO ai_interaction_events (
          id,
          analytics_session_id,
          wa_user_id,
          village_id,
          channel,
          intent,
          success,
          has_knowledge,
          is_fallback,
          agent_mode,
          response_source,
          tools_used_json,
          tool_count,
          model,
          processing_time_ms
        ) VALUES (
          ${randomUUID()},
          ${analyticsSessionId},
          ${opts.waUserId},
          ${opts.villageId ?? null},
          ${opts.channel ?? null},
          ${opts.intent},
          ${opts.success},
          ${opts.hasKnowledge},
          ${opts.isFallback},
          ${opts.agentMode ?? null},
          ${opts.responseSource ?? null},
          ${toolsUsedJson},
          ${Array.isArray(opts.toolsUsed) ? opts.toolsUsed.length : 0},
          ${opts.model ?? null},
          ${opts.processingTimeMs ?? null}
        )
      `);
    } catch (error: any) {
      logger.error('Failed to persist AI interaction analytics', {
        error: error.message,
        intent: opts.intent,
        wa_user_id: opts.waUserId,
      });
    }
  }

  private async persistRetrievalTrace(opts: {
    traceId?: string;
    waUserId?: string;
    query: string;
    retrievalMode: 'rag' | 'keyword' | 'document_rag';
    confidence: 'none' | 'low' | 'medium' | 'high';
    hasKnowledge: boolean;
    resultCount: number;
    searchTimeMs: number;
    topScore: number | null;
    avgTopScore: number | null;
    sourceTitles: string[];
    candidateDebug?: RetrievalTraceEntry['candidateDebug'];
    channel: string;
    villageId?: string;
    timestamp: string;
  }): Promise<void> {
    try {
      const sourceTitlesJson = opts.sourceTitles.length > 0
        ? Prisma.sql`${JSON.stringify(opts.sourceTitles)}::jsonb`
        : Prisma.sql`NULL`;
      const candidateDebugJson = Array.isArray(opts.candidateDebug)
        ? Prisma.sql`${JSON.stringify(opts.candidateDebug)}::jsonb`
        : Prisma.sql`NULL`;

      await prisma.$executeRaw(Prisma.sql`
        INSERT INTO ai_retrieval_traces (
          id,
          trace_id,
          wa_user_id,
          village_id,
          channel,
          query,
          retrieval_mode,
          confidence,
          has_knowledge,
          result_count,
          search_time_ms,
          top_score,
          avg_top_score,
          source_titles_json,
          candidate_debug_json,
          created_at
        ) VALUES (
          ${randomUUID()},
          ${opts.traceId ?? null},
          ${opts.waUserId ?? null},
          ${opts.villageId ?? null},
          ${opts.channel ?? null},
          ${opts.query},
          ${opts.retrievalMode},
          ${opts.confidence},
          ${opts.hasKnowledge},
          ${opts.resultCount},
          ${opts.searchTimeMs},
          ${opts.topScore},
          ${opts.avgTopScore},
          ${sourceTitlesJson},
          ${candidateDebugJson},
          ${new Date(opts.timestamp)}
        )
      `);
    } catch (error: any) {
      logger.error('Failed to persist retrieval trace', {
        error: error.message,
        retrievalMode: opts.retrievalMode,
      });
    }
  }

  async getSummaryDurable(filters?: {
    villageId?: string;
    channel?: string;
  }): Promise<{
    totalRequests: number;
    overallAccuracy: number;
    totalCostUSD: number;
    avgProcessingTimeMs: number;
    topIntents: Array<{ intent: string; count: number; successRate: number }>;
    topPatterns: Array<{ pattern: string; count: number }>;
    tokenUsageLast7Days: Array<{ date: string; tokens: number; cost: number }>;
  }> {
    try {
      const conditions: Prisma.Sql[] = [];
      if (filters?.villageId) conditions.push(Prisma.sql`village_id = ${filters.villageId}`);
      if (filters?.channel) conditions.push(Prisma.sql`channel = ${filters.channel}`);
      const where = conditions.length > 0 ? Prisma.sql`WHERE ${Prisma.join(conditions, ' AND ')}` : Prisma.empty;

      const [summaryRows, topIntentRows, topPatternRows, tokenRows] = await Promise.all([
        prisma.$queryRaw<Array<{
          total_requests: number;
          overall_accuracy: number | null;
          avg_processing_time_ms: number | null;
          total_cost_usd: number | null;
        }>>(Prisma.sql`
          SELECT
            COUNT(*)::int AS total_requests,
            COALESCE(AVG(CASE WHEN success THEN 100.0 ELSE 0.0 END), 0)::float AS overall_accuracy,
            COALESCE(AVG(processing_time_ms), 0)::float AS avg_processing_time_ms,
            COALESCE((
              SELECT SUM(cost_usd)
              FROM ai_token_usage tu
              ${where}
            ), 0)::float AS total_cost_usd
          FROM ai_interaction_events
          ${where}
        `),
        prisma.$queryRaw<Array<{ intent: string; count: number; success_rate: number | null }>>(Prisma.sql`
          SELECT
            intent,
            COUNT(*)::int AS count,
            COALESCE(AVG(CASE WHEN success THEN 100.0 ELSE 0.0 END), 0)::float AS success_rate
          FROM ai_interaction_events
          ${where}
          GROUP BY intent
          ORDER BY count DESC
          LIMIT 10
        `),
        prisma.$queryRaw<Array<{ pattern: string; count: number }>>(Prisma.sql`
          SELECT
            pattern,
            COUNT(*)::int AS count
          FROM (
            SELECT
              analytics_session_id,
              string_agg(intent, ' -> ' ORDER BY created_at ASC) AS pattern
            FROM ai_interaction_events
            ${where}
            GROUP BY analytics_session_id
          ) session_patterns
          GROUP BY pattern
          ORDER BY count DESC
          LIMIT 10
        `),
        prisma.$queryRaw<Array<{ day: Date; tokens: number; cost: number }>>(Prisma.sql`
          SELECT
            date_trunc('day', created_at) AS day,
            COALESCE(SUM(total_tokens), 0)::int AS tokens,
            COALESCE(SUM(cost_usd), 0)::float AS cost
          FROM ai_token_usage
          WHERE created_at >= NOW() - INTERVAL '6 days'
          ${filters?.villageId ? Prisma.sql`AND village_id = ${filters.villageId}` : Prisma.empty}
          ${filters?.channel ? Prisma.sql`AND channel = ${filters.channel}` : Prisma.empty}
          GROUP BY day
          ORDER BY day ASC
        `),
      ]);

      const summary = summaryRows[0] || {
        total_requests: 0,
        overall_accuracy: 0,
        avg_processing_time_ms: 0,
        total_cost_usd: 0,
      };

      const tokenMap = new Map(
        tokenRows.map((row) => [
          row.day instanceof Date ? row.day.toISOString().split('T')[0] : String(row.day),
          row,
        ]),
      );

      const tokenUsageLast7Days = Array.from({ length: 7 }, (_, index) => {
        const date = new Date();
        date.setDate(date.getDate() - (6 - index));
        const key = date.toISOString().split('T')[0];
        const row = tokenMap.get(key);
        return {
          date: key,
          tokens: row?.tokens ?? 0,
          cost: row?.cost ?? 0,
        };
      });

      return {
        totalRequests: summary.total_requests ?? 0,
        overallAccuracy: Math.round(summary.overall_accuracy ?? 0),
        totalCostUSD: Math.round((summary.total_cost_usd ?? 0) * 10000) / 10000,
        avgProcessingTimeMs: Math.round(summary.avg_processing_time_ms ?? 0),
        topIntents: topIntentRows.map((row) => ({
          intent: row.intent,
          count: row.count,
          successRate: Math.round(row.success_rate ?? 0),
        })),
        topPatterns: topPatternRows.map((row) => ({
          pattern: row.pattern,
          count: row.count,
        })),
        tokenUsageLast7Days,
      };
    } catch (error: any) {
      logger.error('Failed to get durable analytics summary, falling back to in-memory', {
        error: error.message,
      });
      return this.getSummary();
    }
  }

  async getIntentDistributionDurable(filters?: {
    villageId?: string;
    channel?: string;
  }): Promise<Array<{ intent: string; count: number; percentage: number }>> {
    try {
      const conditions: Prisma.Sql[] = [];
      if (filters?.villageId) conditions.push(Prisma.sql`village_id = ${filters.villageId}`);
      if (filters?.channel) conditions.push(Prisma.sql`channel = ${filters.channel}`);
      const where = conditions.length > 0 ? Prisma.sql`WHERE ${Prisma.join(conditions, ' AND ')}` : Prisma.empty;

      const rows = await prisma.$queryRaw<Array<{ intent: string; count: number; percentage: number }>>(Prisma.sql`
        WITH total AS (
          SELECT COUNT(*)::float AS total_count
          FROM ai_interaction_events
          ${where}
        )
        SELECT
          intent,
          COUNT(*)::int AS count,
          CASE
            WHEN (SELECT total_count FROM total) > 0
              THEN ROUND((COUNT(*)::float / (SELECT total_count FROM total)) * 100)
            ELSE 0
          END::float AS percentage
        FROM ai_interaction_events
        ${where}
        GROUP BY intent
        ORDER BY count DESC
      `);

      return rows;
    } catch (error: any) {
      logger.error('Failed to get durable intent distribution, falling back to in-memory', {
        error: error.message,
      });
      return this.getIntentDistribution();
    }
  }

  async getConversationFlowDurable(filters?: {
    villageId?: string;
    channel?: string;
  }): Promise<{
    patterns: Array<{ pattern: string; count: number }>;
    dropOffPoints: Array<{ intent: string; count: number }>;
    avgMessagesPerSession: number;
    totalSessions: number;
    knowledge_hit: number;
    knowledge_miss: number;
    fallbackCount: number;
  }> {
    try {
      const conditions: Prisma.Sql[] = [];
      if (filters?.villageId) conditions.push(Prisma.sql`village_id = ${filters.villageId}`);
      if (filters?.channel) conditions.push(Prisma.sql`channel = ${filters.channel}`);
      const where = conditions.length > 0 ? Prisma.sql`WHERE ${Prisma.join(conditions, ' AND ')}` : Prisma.empty;
      const fallbackConditions: Prisma.Sql[] = [...conditions, Prisma.sql`is_fallback = true`];
      const fallbackWhere = Prisma.sql`WHERE ${Prisma.join(fallbackConditions, ' AND ')}`;

      const [sessionRows, patternRows, dropOffRows, fallbackRows, retrievalRows] = await Promise.all([
        prisma.$queryRaw<Array<{ total_sessions: number; total_messages: number; avg_messages_per_session: number | null }>>(Prisma.sql`
          SELECT
            COUNT(DISTINCT analytics_session_id)::int AS total_sessions,
            COUNT(*)::int AS total_messages,
            CASE
              WHEN COUNT(DISTINCT analytics_session_id) > 0
                THEN ROUND((COUNT(*)::float / COUNT(DISTINCT analytics_session_id))::numeric, 1)
              ELSE 0
            END::float AS avg_messages_per_session
          FROM ai_interaction_events
          ${where}
        `),
        prisma.$queryRaw<Array<{ pattern: string; count: number }>>(Prisma.sql`
          SELECT
            pattern,
            COUNT(*)::int AS count
          FROM (
            SELECT
              analytics_session_id,
              string_agg(intent, ' -> ' ORDER BY created_at ASC) AS pattern
            FROM ai_interaction_events
            ${where}
            GROUP BY analytics_session_id
          ) session_patterns
          GROUP BY pattern
          ORDER BY count DESC
          LIMIT 20
        `),
        prisma.$queryRaw<Array<{ intent: string; count: number }>>(Prisma.sql`
          SELECT
            last_intent AS intent,
            COUNT(*)::int AS count
          FROM (
            SELECT
              analytics_session_id,
              (ARRAY_AGG(intent ORDER BY created_at DESC))[1] AS last_intent
            FROM ai_interaction_events
            ${where}
            GROUP BY analytics_session_id
          ) session_last_intents
          GROUP BY last_intent
          ORDER BY count DESC
        `),
        prisma.$queryRaw<Array<{ fallback_count: number }>>(Prisma.sql`
          SELECT COUNT(*)::int AS fallback_count
          FROM ai_interaction_events
          ${fallbackWhere}
        `),
        prisma.$queryRaw<Array<{ knowledge_hit: number; knowledge_miss: number }>>(Prisma.sql`
          SELECT
            COALESCE(SUM(CASE WHEN has_knowledge THEN 1 ELSE 0 END), 0)::int AS knowledge_hit,
            COALESCE(SUM(CASE WHEN has_knowledge THEN 0 ELSE 1 END), 0)::int AS knowledge_miss
          FROM ai_retrieval_traces
          WHERE 1 = 1
          ${filters?.villageId ? Prisma.sql`AND village_id = ${filters.villageId}` : Prisma.empty}
          ${filters?.channel ? Prisma.sql`AND channel = ${filters.channel}` : Prisma.empty}
        `),
      ]);

      const session = sessionRows[0] || {
        total_sessions: 0,
        total_messages: 0,
        avg_messages_per_session: 0,
      };
      const fallback = fallbackRows[0]?.fallback_count ?? 0;
      const retrieval = retrievalRows[0] || { knowledge_hit: 0, knowledge_miss: 0 };

      return {
        patterns: patternRows,
        dropOffPoints: dropOffRows,
        avgMessagesPerSession: session.avg_messages_per_session ?? 0,
        totalSessions: session.total_sessions ?? 0,
        knowledge_hit: retrieval.knowledge_hit ?? 0,
        knowledge_miss: retrieval.knowledge_miss ?? 0,
        fallbackCount: fallback,
      };
    } catch (error: any) {
      logger.error('Failed to get durable conversation flow, falling back to in-memory', {
        error: error.message,
      });
      return {
        ...this.getConversationFlow(),
        fallbackCount: 0,
      };
    }
  }

  async getKnowledgeStatsDurable(filters?: {
    villageId?: string;
    channel?: string;
  }): Promise<{
    hits: number;
    misses: number;
    noKnowledge: number;
    hitRate: number;
    missRate: number;
    topGaps: KnowledgeGapEntry[];
  }> {
    try {
      const rows = await prisma.$queryRaw<Array<{ hits: number; misses: number; no_knowledge: number }>>(Prisma.sql`
        SELECT
          COALESCE(SUM(CASE WHEN has_knowledge THEN 1 ELSE 0 END), 0)::int AS hits,
          COALESCE(SUM(CASE WHEN has_knowledge THEN 0 ELSE 1 END), 0)::int AS misses,
          COALESCE(SUM(CASE WHEN has_knowledge THEN 0 ELSE 1 END), 0)::int AS no_knowledge
        FROM ai_retrieval_traces
        WHERE 1 = 1
        ${filters?.villageId ? Prisma.sql`AND village_id = ${filters.villageId}` : Prisma.empty}
        ${filters?.channel ? Prisma.sql`AND channel = ${filters.channel}` : Prisma.empty}
      `);

      const stats = rows[0] || { hits: 0, misses: 0, no_knowledge: 0 };
      const total = (stats.hits ?? 0) + (stats.misses ?? 0);

      return {
        hits: stats.hits ?? 0,
        misses: stats.misses ?? 0,
        noKnowledge: stats.no_knowledge ?? 0,
        hitRate: total > 0 ? Math.round(((stats.hits ?? 0) / total) * 1000) / 10 : 0,
        missRate: total > 0 ? Math.round(((stats.misses ?? 0) / total) * 1000) / 10 : 0,
        topGaps: [],
      };
    } catch (error: any) {
      logger.error('Failed to get durable knowledge stats, falling back to in-memory', {
        error: error.message,
      });
      return this.getKnowledgeStats();
    }
  }

  async getRetrievalObservabilityDurable(filters?: {
    villageId?: string;
    channel?: string;
  }): Promise<{
    summary: {
      totalTraces: number;
      hitRate: number;
      avgLatencyMs: number;
      p95LatencyMs: number;
      avgResultCount: number;
      avgTopScore: number | null;
    };
    byMode: Array<{
      mode: string;
      count: number;
      hitRate: number;
      avgLatencyMs: number;
      avgResultCount: number;
    }>;
    byConfidence: Array<{
      confidence: string;
      count: number;
      percentage: number;
    }>;
    recentTraces: RetrievalTraceEntry[];
  }> {
    try {
      const traces = await prisma.$queryRaw<Array<{
        query: string;
        retrieval_mode: string;
        confidence: string;
        has_knowledge: boolean;
        result_count: number;
        search_time_ms: number;
        top_score: number | null;
        avg_top_score: number | null;
        source_titles_json: Prisma.JsonValue | string | null;
        candidate_debug_json: Prisma.JsonValue | string | null;
        channel: string | null;
        village_id: string | null;
        created_at: Date;
      }>>(Prisma.sql`
        SELECT
          query,
          retrieval_mode,
          confidence,
          has_knowledge,
          result_count,
          search_time_ms,
          top_score,
          avg_top_score,
          source_titles_json,
          candidate_debug_json,
          channel,
          village_id,
          created_at
        FROM ai_retrieval_traces
        WHERE 1 = 1
        ${filters?.villageId ? Prisma.sql`AND village_id = ${filters.villageId}` : Prisma.empty}
        ${filters?.channel ? Prisma.sql`AND channel = ${filters.channel}` : Prisma.empty}
        ORDER BY created_at DESC
        LIMIT 250
      `);

      const normalizedTraces: RetrievalTraceEntry[] = traces.map((trace) => ({
        query: trace.query,
        retrievalMode: trace.retrieval_mode as RetrievalTraceEntry['retrievalMode'],
        confidence: trace.confidence as RetrievalTraceEntry['confidence'],
        hasKnowledge: trace.has_knowledge,
        resultCount: trace.result_count,
        searchTimeMs: trace.search_time_ms,
        topScore: trace.top_score,
        avgTopScore: trace.avg_top_score,
        sourceTitles: this.parseJsonArray<string>(trace.source_titles_json),
        candidateDebug: this.parseJsonArray<NonNullable<RetrievalTraceEntry['candidateDebug']>[number]>(
          trace.candidate_debug_json,
        ),
        channel: trace.channel || 'system',
        villageId: trace.village_id || undefined,
        timestamp: trace.created_at.toISOString(),
      }));

      return this.getRetrievalObservabilityFromTraces(normalizedTraces);
    } catch (error: any) {
      logger.error('Failed to get durable retrieval observability, falling back to in-memory', {
        error: error.message,
      });
      return this.getRetrievalObservability(filters);
    }
  }

  private parseJsonArray<T>(value: Prisma.JsonValue | string | null | undefined): T[] {
    if (!value) {
      return [];
    }

    if (Array.isArray(value)) {
      return value as T[];
    }

    if (typeof value === 'string') {
      try {
        const parsed = JSON.parse(value);
        return Array.isArray(parsed) ? (parsed as T[]) : [];
      } catch {
        return [];
      }
    }

    return [];
  }

  private getRetrievalObservabilityFromTraces(traces: RetrievalTraceEntry[]): {
    summary: {
      totalTraces: number;
      hitRate: number;
      avgLatencyMs: number;
      p95LatencyMs: number;
      avgResultCount: number;
      avgTopScore: number | null;
    };
    byMode: Array<{
      mode: string;
      count: number;
      hitRate: number;
      avgLatencyMs: number;
      avgResultCount: number;
    }>;
    byConfidence: Array<{
      confidence: string;
      count: number;
      percentage: number;
    }>;
    recentTraces: RetrievalTraceEntry[];
  } {
    const totalTraces = traces.length;
    const hitCount = traces.filter((trace) => trace.hasKnowledge).length;
    const latencies = traces
      .map((trace) => trace.searchTimeMs)
      .filter((value) => Number.isFinite(value) && value >= 0)
      .sort((a, b) => a - b);
    const resultCounts = traces.map((trace) => trace.resultCount);
    const scored = traces
      .map((trace) => trace.topScore)
      .filter((score): score is number => typeof score === 'number' && Number.isFinite(score));

    const byMode = Array.from(
      traces.reduce((acc, trace) => {
        const bucket = acc.get(trace.retrievalMode) || {
          mode: trace.retrievalMode,
          count: 0,
          hitCount: 0,
          totalLatencyMs: 0,
          totalResultCount: 0,
        };

        bucket.count++;
        bucket.hitCount += trace.hasKnowledge ? 1 : 0;
        bucket.totalLatencyMs += trace.searchTimeMs;
        bucket.totalResultCount += trace.resultCount;
        acc.set(trace.retrievalMode, bucket);
        return acc;
      }, new Map<string, {
        mode: string;
        count: number;
        hitCount: number;
        totalLatencyMs: number;
        totalResultCount: number;
      }>()),
    )
      .map(([, bucket]) => ({
        mode: bucket.mode,
        count: bucket.count,
        hitRate: bucket.count > 0 ? Math.round((bucket.hitCount / bucket.count) * 1000) / 10 : 0,
        avgLatencyMs: bucket.count > 0 ? Math.round(bucket.totalLatencyMs / bucket.count) : 0,
        avgResultCount: bucket.count > 0 ? Math.round((bucket.totalResultCount / bucket.count) * 10) / 10 : 0,
      }))
      .sort((a, b) => b.count - a.count);

    const byConfidence = Array.from(
      traces.reduce((acc, trace) => {
        acc.set(trace.confidence, (acc.get(trace.confidence) || 0) + 1);
        return acc;
      }, new Map<string, number>()),
    )
      .map(([confidence, count]) => ({
        confidence,
        count,
        percentage: totalTraces > 0 ? Math.round((count / totalTraces) * 1000) / 10 : 0,
      }))
      .sort((a, b) => b.count - a.count);

    const p95LatencyMs = latencies.length > 0
      ? latencies[Math.min(latencies.length - 1, Math.max(0, Math.ceil(latencies.length * 0.95) - 1))]
      : 0;

    return {
      summary: {
        totalTraces,
        hitRate: totalTraces > 0 ? Math.round((hitCount / totalTraces) * 1000) / 10 : 0,
        avgLatencyMs: latencies.length > 0
          ? Math.round(latencies.reduce((sum, value) => sum + value, 0) / latencies.length)
          : 0,
        p95LatencyMs,
        avgResultCount: resultCounts.length > 0
          ? Math.round((resultCounts.reduce((sum, value) => sum + value, 0) / resultCounts.length) * 10) / 10
          : 0,
        avgTopScore: scored.length > 0
          ? Math.round((scored.reduce((sum, value) => sum + value, 0) / scored.length) * 1000) / 1000
          : null,
      },
      byMode,
      byConfidence,
      recentTraces: traces.slice(0, 50),
    };
  }

  /**
   * Record failed action (required retry or user correction)
   */
  recordFailure(intent: string, correctedIntent?: string): void {
    if (this.data.intents[intent]) {
      this.data.intents[intent].failCount++;
    }

    // Record in confusion matrix if there was a correction
    if (correctedIntent && correctedIntent !== intent) {
      if (!this.data.accuracy.confusionMatrix[intent]) {
        this.data.accuracy.confusionMatrix[intent] = {};
      }
      if (!this.data.accuracy.confusionMatrix[intent][correctedIntent]) {
        this.data.accuracy.confusionMatrix[intent][correctedIntent] = 0;
      }
      this.data.accuracy.confusionMatrix[intent][correctedIntent]++;
    }
  }

  /**
   * Update session for conversation flow tracking
   */
  private updateSession(wa_user_id: string, intent: string): void {
    const now = Date.now();
    
    if (!this.sessions.has(wa_user_id)) {
      // New session
      this.sessions.set(wa_user_id, {
        wa_user_id,
        intents: [intent],
        startTime: now,
        lastActivity: now,
      });
      this.data.conversationFlow.totalSessions++;
    } else {
      const session = this.sessions.get(wa_user_id)!;
      
      // Check if session expired
      if (now - session.lastActivity > SESSION_TIMEOUT_MS) {
        // Record old session and start new one
        this.recordSessionEnd(session);
        this.sessions.set(wa_user_id, {
          wa_user_id,
          intents: [intent],
          startTime: now,
          lastActivity: now,
        });
        this.data.conversationFlow.totalSessions++;
      } else {
        // Continue existing session
        session.intents.push(intent);
        session.lastActivity = now;
      }
    }

    this.data.conversationFlow.totalMessages++;
    this.data.conversationFlow.avgMessagesPerSession = 
      this.data.conversationFlow.totalMessages / this.data.conversationFlow.totalSessions;
  }

  /**
   * Record session end (for pattern analysis)
   */
  private recordSessionEnd(session: SessionData): void {
    if (session.intents.length > 0) {
      // Create pattern string
      const pattern = session.intents.join(' -> ');
      if (!this.data.conversationFlow.patterns[pattern]) {
        this.data.conversationFlow.patterns[pattern] = 0;
      }
      this.data.conversationFlow.patterns[pattern]++;

      // Record drop-off point (last intent)
      const lastIntent = session.intents[session.intents.length - 1];
      if (!this.data.conversationFlow.dropOffPoints[lastIntent]) {
        this.data.conversationFlow.dropOffPoints[lastIntent] = 0;
      }
      this.data.conversationFlow.dropOffPoints[lastIntent]++;
    }
  }

  /**
   * Record token usage and calculate cost
   * Uses token-usage.service pricing as single source of truth
   */
  private recordTokenUsage(model: string, inputChars: number, outputChars: number): void {
    const inputTokens = Math.ceil(inputChars / CHARS_PER_TOKEN);
    const outputTokens = Math.ceil(outputChars / CHARS_PER_TOKEN);
    
    const pricing = getTokenPricing(model);
    const costUSD = (inputTokens * pricing.input + outputTokens * pricing.output) / 1_000_000;

    // Update totals
    this.data.tokenUsage.totalInputTokens += inputTokens;
    this.data.tokenUsage.totalOutputTokens += outputTokens;
    this.data.tokenUsage.totalCostUSD += costUSD;

    // Update by model
    if (!this.data.tokenUsage.byModel[model]) {
      this.data.tokenUsage.byModel[model] = {
        inputTokens: 0,
        outputTokens: 0,
        costUSD: 0,
        callCount: 0,
      };
    }
    this.data.tokenUsage.byModel[model].inputTokens += inputTokens;
    this.data.tokenUsage.byModel[model].outputTokens += outputTokens;
    this.data.tokenUsage.byModel[model].costUSD += costUSD;
    this.data.tokenUsage.byModel[model].callCount++;

    // Update by day
    const today = new Date().toISOString().split('T')[0];
    if (!this.data.tokenUsage.byDay[today]) {
      this.data.tokenUsage.byDay[today] = {
        inputTokens: 0,
        outputTokens: 0,
        costUSD: 0,
      };
    }
    this.data.tokenUsage.byDay[today].inputTokens += inputTokens;
    this.data.tokenUsage.byDay[today].outputTokens += outputTokens;
    this.data.tokenUsage.byDay[today].costUSD += costUSD;
  }

  /**
   * Get all analytics data
   */
  getAllAnalytics(): AnalyticsStorage {
    return this.data;
  }

  /**
   * Get summary for dashboard
   */
  getSummary(): {
    totalRequests: number;
    overallAccuracy: number;
    totalCostUSD: number;
    avgProcessingTimeMs: number;
    topIntents: Array<{ intent: string; count: number; successRate: number }>;
    topPatterns: Array<{ pattern: string; count: number }>;
    tokenUsageLast7Days: Array<{ date: string; tokens: number; cost: number }>;
  } {
    // Calculate total requests and avg processing time
    let totalRequests = 0;
    let totalProcessingTime = 0;
    const intentSummaries: Array<{ intent: string; count: number; successRate: number }> = [];

    for (const [intent, stats] of Object.entries(this.data.intents)) {
      totalRequests += stats.count;
      totalProcessingTime += stats.totalProcessingTimeMs;
      
      const successRate = stats.count > 0 
        ? Math.round((stats.successCount / stats.count) * 100) 
        : 0;
      
      intentSummaries.push({
        intent,
        count: stats.count,
        successRate,
      });
    }

    // Sort intents by count
    intentSummaries.sort((a, b) => b.count - a.count);

    // Get top patterns
    const patternEntries = Object.entries(this.data.conversationFlow.patterns)
      .map(([pattern, count]) => ({ pattern, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 10);

    // Get token usage last 7 days
    const last7Days = this.getLast7DaysTokenUsage();

    return {
      totalRequests,
      overallAccuracy: this.data.accuracy.overallAccuracy,
      totalCostUSD: Math.round(this.data.tokenUsage.totalCostUSD * 10000) / 10000, // 4 decimal places
      avgProcessingTimeMs: totalRequests > 0 
        ? Math.round(totalProcessingTime / totalRequests) 
        : 0,
      topIntents: intentSummaries.slice(0, 10),
      topPatterns: patternEntries,
      tokenUsageLast7Days: last7Days,
    };
  }

  /**
   * Get token usage for last 7 days
   */
  private getLast7DaysTokenUsage(): Array<{ date: string; tokens: number; cost: number }> {
    const result: Array<{ date: string; tokens: number; cost: number }> = [];
    const today = new Date();
    
    for (let i = 6; i >= 0; i--) {
      const date = new Date(today);
      date.setDate(date.getDate() - i);
      const dateStr = date.toISOString().split('T')[0];
      
      const dayData = this.data.tokenUsage.byDay[dateStr];
      result.push({
        date: dateStr,
        tokens: dayData ? dayData.inputTokens + dayData.outputTokens : 0,
        cost: dayData ? Math.round(dayData.costUSD * 10000) / 10000 : 0,
      });
    }
    
    return result;
  }

  /**
   * Get intent distribution for pie chart
   */
  getIntentDistribution(): Array<{ intent: string; count: number; percentage: number }> {
    const total = Object.values(this.data.intents).reduce((sum, s) => sum + s.count, 0);
    
    return Object.entries(this.data.intents)
      .map(([intent, stats]) => ({
        intent,
        count: stats.count,
        percentage: total > 0 ? Math.round((stats.count / total) * 100) : 0,
      }))
      .sort((a, b) => b.count - a.count);
  }

  /**
   * Get conversation flow for sankey/flow diagram
   */
  getConversationFlow(): {
    patterns: Array<{ pattern: string; count: number }>;
    dropOffPoints: Array<{ intent: string; count: number }>;
    avgMessagesPerSession: number;
    totalSessions: number;
    knowledge_hit: number;
    knowledge_miss: number;
  } {
    return {
      patterns: Object.entries(this.data.conversationFlow.patterns)
        .map(([pattern, count]) => ({ pattern, count }))
        .sort((a, b) => b.count - a.count)
        .slice(0, 20),
      dropOffPoints: Object.entries(this.data.conversationFlow.dropOffPoints)
        .map(([intent, count]) => ({ intent, count }))
        .sort((a, b) => b.count - a.count),
      avgMessagesPerSession: Math.round(this.data.conversationFlow.avgMessagesPerSession * 10) / 10,
      totalSessions: this.data.conversationFlow.totalSessions,
      knowledge_hit: this.data.knowledge.hits,
      knowledge_miss: this.data.knowledge.misses,
    };
  }

  /**
   * Get token usage breakdown
   */
  getTokenUsageBreakdown(): {
    total: { input: number; output: number; cost: number };
    byModel: Array<{ model: string; input: number; output: number; cost: number; calls: number }>;
    last30Days: Array<{ date: string; input: number; output: number; cost: number }>;
  } {
    // Get last 30 days
    const last30Days: Array<{ date: string; input: number; output: number; cost: number }> = [];
    const today = new Date();
    
    for (let i = 29; i >= 0; i--) {
      const date = new Date(today);
      date.setDate(date.getDate() - i);
      const dateStr = date.toISOString().split('T')[0];
      
      const dayData = this.data.tokenUsage.byDay[dateStr];
      last30Days.push({
        date: dateStr,
        input: dayData?.inputTokens || 0,
        output: dayData?.outputTokens || 0,
        cost: Math.round((dayData?.costUSD || 0) * 10000) / 10000,
      });
    }

    return {
      total: {
        input: this.data.tokenUsage.totalInputTokens,
        output: this.data.tokenUsage.totalOutputTokens,
        cost: Math.round(this.data.tokenUsage.totalCostUSD * 10000) / 10000,
      },
      byModel: Object.entries(this.data.tokenUsage.byModel)
        .map(([model, data]) => ({
          model,
          input: data.inputTokens,
          output: data.outputTokens,
          cost: Math.round(data.costUSD * 10000) / 10000,
          calls: data.callCount,
        }))
        .sort((a, b) => b.calls - a.calls),
      last30Days,
    };
  }

  /**
   * Record category usage for tracking popular vs rare categories
   */
  recordCategoryUsage(type: 'complaint' | 'knowledge' | 'service', category: string): void {
    if (!category || category.length === 0) return;
    
    const normalized = category.toLowerCase().trim();
    const bucket = this.data.categoryUsage[type];
    
    if (!bucket[normalized]) {
      bucket[normalized] = {
        category: normalized,
        count: 0,
        lastUsed: new Date().toISOString(),
      };
    }
    
    bucket[normalized].count++;
    bucket[normalized].lastUsed = new Date().toISOString();
  }

  /**
   * Get category usage statistics
   */
  getCategoryUsageStats(): {
    complaint: Array<{ category: string; count: number; lastUsed: string }>;
    knowledge: Array<{ category: string; count: number; lastUsed: string }>;
    service: Array<{ category: string; count: number; lastUsed: string }>;
    summary: {
      totalComplaintCategories: number;
      totalKnowledgeCategories: number;
      totalServiceCategories: number;
      topComplaint: string | null;
      topKnowledge: string | null;
      topService: string | null;
    };
  } {
    const sortByCount = (entries: CategoryUsageEntry[]) => 
      entries.sort((a, b) => b.count - a.count);

    const complaintArr = sortByCount(Object.values(this.data.categoryUsage.complaint));
    const knowledgeArr = sortByCount(Object.values(this.data.categoryUsage.knowledge));
    const serviceArr = sortByCount(Object.values(this.data.categoryUsage.service));

    return {
      complaint: complaintArr,
      knowledge: knowledgeArr,
      service: serviceArr,
      summary: {
        totalComplaintCategories: complaintArr.length,
        totalKnowledgeCategories: knowledgeArr.length,
        totalServiceCategories: serviceArr.length,
        topComplaint: complaintArr[0]?.category || null,
        topKnowledge: knowledgeArr[0]?.category || null,
        topService: serviceArr[0]?.category || null,
      },
    };
  }

  /**
   * Reset all analytics data (for fixing corrupted data)
   */
  resetAnalytics(): void {
    logger.warn('🔄 Resetting all AI analytics data');
    this.data = this.getDefaultStorage();
    this.sessions.clear();
    logger.info('✅ AI Analytics reset complete');
  }

  /**
   * Validate and fix corrupted data
   */
  validateAndFixData(): void {
    let fixed = false;
    
    // Fix corrupted processing times (should be < 5 minutes = 300000ms)
    for (const [intent, stats] of Object.entries(this.data.intents)) {
      if (stats.avgProcessingTimeMs > 300000 || stats.totalProcessingTimeMs > 300000 * stats.count) {
        logger.warn('🔧 Fixing corrupted processing time for intent', { intent, avgMs: stats.avgProcessingTimeMs });
        stats.avgProcessingTimeMs = 3000; // Default to 3 seconds
        stats.totalProcessingTimeMs = stats.count * 3000;
        fixed = true;
      }
    }
    
    // Fix accuracy calculations - recalculate correct counts for non-action intents
    const actionIntents = ['CREATE_COMPLAINT', 'SERVICE_INFO', 'CREATE_SERVICE_REQUEST', 'CHECK_STATUS', 'HISTORY'];
    let totalCorrect = 0;
    
    for (const [intent, stats] of Object.entries(this.data.accuracy.byIntent)) {
      // For non-action intents, correct should equal total (auto-success)
      if (!actionIntents.includes(intent)) {
        if (stats.correct !== stats.total) {
          logger.warn('🔧 Fixing correct count for non-action intent', { intent, was: stats.correct, now: stats.total });
          stats.correct = stats.total;
          fixed = true;
        }
      }
      
      // Recalculate accuracy
      const expectedAccuracy = stats.total > 0 
        ? Math.round((stats.correct / stats.total) * 100) 
        : 0;
      if (stats.accuracy !== expectedAccuracy) {
        logger.warn('🔧 Fixing accuracy for intent', { intent, was: stats.accuracy, now: expectedAccuracy });
        stats.accuracy = expectedAccuracy;
        fixed = true;
      }
      
      totalCorrect += stats.correct;
    }
    
    // Fix correctClassifications total
    if (this.data.accuracy.correctClassifications !== totalCorrect) {
      logger.warn('🔧 Fixing correctClassifications', { was: this.data.accuracy.correctClassifications, now: totalCorrect });
      this.data.accuracy.correctClassifications = totalCorrect;
      fixed = true;
    }
    
    // Recalculate overall accuracy
    const expectedOverall = this.data.accuracy.totalClassifications > 0
      ? Math.round((this.data.accuracy.correctClassifications / this.data.accuracy.totalClassifications) * 100)
      : 0;
    if (this.data.accuracy.overallAccuracy !== expectedOverall) {
      logger.warn('🔧 Fixing overall accuracy', { was: this.data.accuracy.overallAccuracy, now: expectedOverall });
      this.data.accuracy.overallAccuracy = expectedOverall;
      fixed = true;
    }
    
    if (fixed) {
      logger.info('🔧 Analytics data validation fixed issues');
    }
    logger.info('✅ Analytics data validation and fix complete');
  }

}

// Export singleton
export const aiAnalyticsService = new AIAnalyticsService();
