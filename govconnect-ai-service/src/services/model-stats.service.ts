/**
 * Model Statistics Service
 * 
 * Tracks LLM model performance metrics for dynamic priority selection.
 * Uses in-memory storage with periodic persistence to file.
 */

import fs from 'fs';
import path from 'path';
import logger from '../utils/logger';

interface ModelStats {
  model: string;
  totalCalls: number;
  successCalls: number;
  failedCalls: number;
  successRate: number;
  avgResponseTimeMs: number;
  totalResponseTimeMs: number;
  lastUsed: string;
  lastError?: string;
  errorHistory: Array<{
    timestamp: string;
    error: string;
  }>;
}

interface StatsStorage {
  models: Record<string, ModelStats>;
  lastUpdated: string;
  totalRequests: number;
}

const STATS_FILE_PATH = path.join(process.cwd(), 'data', 'model-stats.json');
const SAVE_INTERVAL_MS = 60000; // Save every 1 minute

class ModelStatsService {
  private stats: StatsStorage;
  private saveInterval: ReturnType<typeof setInterval> | null = null;
  private isDirty: boolean = false;

  constructor() {
    this.stats = this.loadStats();
    this.startPeriodicSave();
  }

  /**
   * Load stats from file or create default
   */
  private loadStats(): StatsStorage {
    try {
      // Ensure data directory exists
      const dataDir = path.dirname(STATS_FILE_PATH);
      if (!fs.existsSync(dataDir)) {
        fs.mkdirSync(dataDir, { recursive: true });
      }

      if (fs.existsSync(STATS_FILE_PATH)) {
        const data = fs.readFileSync(STATS_FILE_PATH, 'utf-8');
        const parsed = JSON.parse(data) as StatsStorage;
        logger.info('📊 Model stats loaded from file', {
          totalRequests: parsed.totalRequests,
          models: Object.keys(parsed.models).length,
        });
        return parsed;
      }
    } catch (error) {
      logger.warn('⚠️ Could not load model stats, starting fresh', {
        error: (error as Error).message,
      });
    }

    return {
      models: {},
      lastUpdated: new Date().toISOString(),
      totalRequests: 0,
    };
  }

  /**
   * Save stats to file
   */
  private saveStats(): void {
    try {
      const dataDir = path.dirname(STATS_FILE_PATH);
      if (!fs.existsSync(dataDir)) {
        fs.mkdirSync(dataDir, { recursive: true });
      }

      this.stats.lastUpdated = new Date().toISOString();
      fs.writeFileSync(STATS_FILE_PATH, JSON.stringify(this.stats, null, 2));
      this.isDirty = false;
      
      logger.debug('💾 Model stats saved to file');
    } catch (error) {
      logger.error('❌ Failed to save model stats', {
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
        this.saveStats();
      }
    }, SAVE_INTERVAL_MS);
  }

  /**
   * Initialize stats for a model if not exists
   */
  private ensureModelStats(model: string): ModelStats {
    if (!this.stats.models[model]) {
      this.stats.models[model] = {
        model,
        totalCalls: 0,
        successCalls: 0,
        failedCalls: 0,
        successRate: 0,
        avgResponseTimeMs: 0,
        totalResponseTimeMs: 0,
        lastUsed: new Date().toISOString(),
        errorHistory: [],
      };
    }
    return this.stats.models[model];
  }

  /**
   * Record a successful model call
   */
  recordSuccess(model: string, responseTimeMs: number): void {
    const stats = this.ensureModelStats(model);
    
    stats.totalCalls++;
    stats.successCalls++;
    stats.totalResponseTimeMs += responseTimeMs;
    stats.avgResponseTimeMs = Math.round(stats.totalResponseTimeMs / stats.totalCalls);
    stats.successRate = Math.round((stats.successCalls / stats.totalCalls) * 100);
    stats.lastUsed = new Date().toISOString();
    
    this.stats.totalRequests++;
    this.isDirty = true;

    logger.info('📈 Model success recorded', {
      model,
      successRate: `${stats.successRate}%`,
      totalCalls: stats.totalCalls,
      avgResponseTime: `${stats.avgResponseTimeMs}ms`,
    });
  }

  /**
   * Record a failed model call
   */
  recordFailure(model: string, error: string, responseTimeMs: number): void {
    const stats = this.ensureModelStats(model);
    
    stats.totalCalls++;
    stats.failedCalls++;
    stats.totalResponseTimeMs += responseTimeMs;
    stats.avgResponseTimeMs = Math.round(stats.totalResponseTimeMs / stats.totalCalls);
    stats.successRate = Math.round((stats.successCalls / stats.totalCalls) * 100);
    stats.lastUsed = new Date().toISOString();
    stats.lastError = error;
    
    // Keep last 10 errors
    stats.errorHistory.push({
      timestamp: new Date().toISOString(),
      error,
    });
    if (stats.errorHistory.length > 10) {
      stats.errorHistory = stats.errorHistory.slice(-10);
    }

    this.stats.totalRequests++;
    this.isDirty = true;

    logger.warn('📉 Model failure recorded', {
      model,
      successRate: `${stats.successRate}%`,
      totalCalls: stats.totalCalls,
      failedCalls: stats.failedCalls,
      error: error.substring(0, 100),
    });
  }

  /**
   * Get models sorted by priority (success rate, then avg response time)
   */
  getModelPriority(availableModels: string[]): string[] {
    // Get stats for available models
    const modelStatsArray = availableModels.map(model => {
      const stats = this.stats.models[model];
      return {
        model,
        successRate: stats?.successRate ?? 100, // New models start with 100%
        avgResponseTimeMs: stats?.avgResponseTimeMs ?? 0,
        totalCalls: stats?.totalCalls ?? 0,
      };
    });

    // Sort by:
    // 1. Success rate (higher is better)
    // 2. Average response time (lower is better)
    // 3. New models get slight priority (totalCalls < 5)
    modelStatsArray.sort((a, b) => {
      // If one has fewer than 5 calls and the other has more, prioritize the established one
      // unless the established one has very low success rate
      if (a.totalCalls >= 5 && b.totalCalls < 5 && a.successRate >= 70) {
        return -1;
      }
      if (b.totalCalls >= 5 && a.totalCalls < 5 && b.successRate >= 70) {
        return 1;
      }

      // Sort by success rate first
      if (a.successRate !== b.successRate) {
        return b.successRate - a.successRate;
      }

      // Then by response time
      return a.avgResponseTimeMs - b.avgResponseTimeMs;
    });

    const priority = modelStatsArray.map(s => s.model);
    
    logger.debug('🎯 Model priority calculated', {
      priority,
      stats: modelStatsArray.map(s => ({
        model: s.model,
        successRate: `${s.successRate}%`,
        calls: s.totalCalls,
      })),
    });

    return priority;
  }

  /**
   * Get all stats for monitoring/debugging
   */
  getAllStats(): StatsStorage {
    return this.stats;
  }

  /**
   * Get stats for a specific model
   */
  getModelStats(model: string): ModelStats | null {
    return this.stats.models[model] || null;
  }

  /**
   * Force save stats (for graceful shutdown)
   */
  forceSave(): void {
    this.saveStats();
  }

  /**
   * Cleanup on shutdown
   */
  shutdown(): void {
    if (this.saveInterval) {
      clearInterval(this.saveInterval);
    }
    this.saveStats();
    logger.info('📊 Model stats service shutdown complete');
  }
}

// Export singleton instance
export const modelStatsService = new ModelStatsService();

// Handle graceful shutdown
process.on('SIGTERM', () => modelStatsService.shutdown());
process.on('SIGINT', () => modelStatsService.shutdown());
