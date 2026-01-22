/**
 * AI Analytics Service
 * 
 * Tracks and analyzes AI performance metrics:
 * - Intent classification accuracy
 * - Token usage and cost estimation
 * - Conversation flow patterns
 * - Response quality metrics
 */

import fs from 'fs';
import path from 'path';
import logger from '../utils/logger';

// Gemini pricing per 1M tokens (in USD) - December 2025
// https://ai.google.dev/pricing - Updated December 2025
const GEMINI_PRICING: Record<string, { input: number; output: number; description: string }> = {
  // Gemini 2.5 Flash - Hybrid reasoning model, 1M context, best price/performance
  'gemini-2.5-flash': { input: 0.30, output: 2.50, description: 'Hybrid reasoning, 1M context, thinking budget' },
  // Gemini 2.5 Flash-Lite - Smallest, most cost-efficient
  'gemini-2.5-flash-lite': { input: 0.10, output: 0.40, description: 'Smallest, cost-efficient, high throughput' },
  'gemini-2.0-flash': { input: 0.10, output: 0.40, description: 'Balanced multimodal, 1M context' },
  // Gemini 2.0 Flash-Lite - Legacy cost-efficient
  'gemini-2.0-flash-lite': { input: 0.075, output: 0.30, description: 'Legacy cost-efficient' },
  // Default fallback
  'default': { input: 0.10, output: 0.40, description: 'Default pricing' },
};

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

interface AnalyticsStorage {
  intents: Record<string, IntentStats>;
  conversationFlow: ConversationFlowStats;
  tokenUsage: TokenUsageStats;
  accuracy: AccuracyStats;
  lastUpdated: string;
}

interface SessionData {
  wa_user_id: string;
  intents: string[];
  startTime: number;
  lastActivity: number;
}

const ANALYTICS_FILE_PATH = path.join(process.cwd(), 'data', 'ai-analytics.json');
const SAVE_INTERVAL_MS = 60000; // Save every 1 minute
const SESSION_TIMEOUT_MS = 30 * 60 * 1000; // 30 minutes

class AIAnalyticsService {
  private data: AnalyticsStorage;
  private sessions: Map<string, SessionData> = new Map();
  private saveInterval: ReturnType<typeof setInterval> | null = null;
  private isDirty: boolean = false;

  constructor() {
    this.data = this.loadData();
    this.validateAndFixData(); // Fix any corrupted data on startup
    this.startPeriodicSave();
    this.startSessionCleanup();
    logger.info('📊 AI Analytics Service initialized');
  }

  /**
   * Load data from file or create default
   */
  private loadData(): AnalyticsStorage {
    try {
      const dataDir = path.dirname(ANALYTICS_FILE_PATH);
      if (!fs.existsSync(dataDir)) {
        fs.mkdirSync(dataDir, { recursive: true });
      }

      if (fs.existsSync(ANALYTICS_FILE_PATH)) {
        const data = fs.readFileSync(ANALYTICS_FILE_PATH, 'utf-8');
        const parsed = JSON.parse(data) as AnalyticsStorage;
        logger.info('📊 AI Analytics loaded from file');
        return parsed;
      }
    } catch (error) {
      logger.warn('⚠️ Could not load AI analytics, starting fresh', {
        error: (error as Error).message,
      });
    }

    return this.getDefaultStorage();
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
   * Save data to file
   */
  private saveData(): void {
    try {
      const dataDir = path.dirname(ANALYTICS_FILE_PATH);
      if (!fs.existsSync(dataDir)) {
        fs.mkdirSync(dataDir, { recursive: true });
      }

      this.data.lastUpdated = new Date().toISOString();
      fs.writeFileSync(ANALYTICS_FILE_PATH, JSON.stringify(this.data, null, 2));
      this.isDirty = false;
      
      logger.debug('💾 AI Analytics saved to file');
    } catch (error) {
      logger.error('❌ Failed to save AI analytics', {
        error: (error as Error).message,
      });
    }
  }

  /**
   * Start periodic save interval
   */
  private startPeriodicSave(): void {
    this.saveInterval = setInterval(() => {
      if (this.isDirty) {
        this.saveData();
      }
    }, SAVE_INTERVAL_MS);
  }

  /**
   * Start session cleanup (every 10 minutes)
   */
  private startSessionCleanup(): void {
    setInterval(() => {
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
    }, 10 * 60 * 1000);
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

    this.isDirty = true;
  }

  /**
   * Record successful action (complaint/service request created successfully)
   */
  recordSuccess(intent: string): void {
    if (this.data.intents[intent]) {
      this.data.intents[intent].successCount++;
      this.isDirty = true;
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
    this.isDirty = true;
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

    this.isDirty = true;
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

      this.isDirty = true;
    }
  }

  /**
   * Record token usage and calculate cost
   */
  private recordTokenUsage(model: string, inputChars: number, outputChars: number): void {
    const inputTokens = Math.ceil(inputChars / CHARS_PER_TOKEN);
    const outputTokens = Math.ceil(outputChars / CHARS_PER_TOKEN);
    
    const pricing = GEMINI_PRICING[model as keyof typeof GEMINI_PRICING] || GEMINI_PRICING.default;
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
   * Reset all analytics data (for fixing corrupted data)
   */
  resetAnalytics(): void {
    logger.warn('🔄 Resetting all AI analytics data');
    this.data = this.getDefaultStorage();
    this.sessions.clear();
    this.saveData();
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
      this.saveData();
    }
    logger.info('✅ Analytics data validation and fix complete');
  }

  /**
   * Force save (for shutdown)
   */
  forceSave(): void {
    // End all active sessions first
    for (const session of this.sessions.values()) {
      this.recordSessionEnd(session);
    }
    this.saveData();
  }

  /**
   * Shutdown cleanup
   */
  shutdown(): void {
    if (this.saveInterval) {
      clearInterval(this.saveInterval);
    }
    this.forceSave();
    logger.info('📊 AI Analytics Service shutdown complete');
  }
}

// Export singleton
export const aiAnalyticsService = new AIAnalyticsService();

// Graceful shutdown
process.on('SIGTERM', () => aiAnalyticsService.shutdown());
process.on('SIGINT', () => aiAnalyticsService.shutdown());
