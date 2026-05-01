/**
 * Rate Limiter Service
 * 
 * Controls rate limiting per user to prevent spam:
 * - Max reports per day per phone number
 * - Cooldown period between reports
 * - Blacklist management for spam numbers
 */

import logger from '../utils/logger';
import { config } from '../config/env';
import { registerInterval } from '../utils/timer-registry';
import prisma from '../lib/prisma';

interface UserRateData {
  wa_user_id: string;
  village_id?: string;
  scopeKey: string;
  dailyReports: number;
  lastReportTime: number; // Unix timestamp
  date: string; // YYYY-MM-DD
  violations: number; // Number of rate limit violations
}

interface BlacklistEntry {
  wa_user_id: string;
  village_id?: string;
  scopeKey: string;
  reason: string;
  addedAt: string;
  addedBy: string; // 'system' or admin username
  expiresAt?: string; // Optional expiration
}

interface RateLimitStorage {
  users: Record<string, UserRateData>;
  blacklist: Record<string, BlacklistEntry>;
  lastUpdated: string;
}

interface RateLimitResult {
  allowed: boolean;
  reason?: 'rate_limit' | 'cooldown' | 'blacklisted' | 'disabled';
  remainingReports?: number;
  cooldownRemaining?: number; // seconds
  message?: string;
}

interface RateLimitStats {
  totalBlocked: number;
  totalBlacklisted: number;
  activeUsers: number;
  topViolators: Array<{
    wa_user_id: string;
    violations: number;
    dailyReports: number;
  }>;
}

class RateLimiterService {
  private data: RateLimitStorage;
  private blockedCount: number = 0;

  constructor() {
    this.data = {
      users: {},
      blacklist: {},
      lastUpdated: new Date().toISOString(),
    };
    this.startDailyReset();
    this.loadBlacklistFromDB(); // Temuan 8: hydrate from DB on startup
    logger.info('🛡️ Rate Limiter Service initialized (in-memory + DB blacklist)', {
      enabled: config.rateLimitEnabled,
      maxReportsPerDay: config.maxReportsPerDay,
      cooldownSeconds: config.cooldownSeconds,
    });
  }

  private getScopeKey(wa_user_id: string, village_id?: string | null): string {
    return `${village_id || '__global__'}:${wa_user_id}`;
  }

  private getScopeLabel(village_id?: string | null): string {
    return village_id || 'global';
  }

  /**
   * Load blacklist from PostgreSQL on startup (Temuan 8)
   */
  private async loadBlacklistFromDB(): Promise<void> {
    try {
      const rows = await prisma.$queryRaw<Array<{
        wa_user_id: string;
        village_id: string | null;
        scope_key: string | null;
        reason: string;
        blocked_at: Date;
        expires_at: Date | null;
      }>>`
        SELECT wa_user_id, village_id, scope_key, reason, blocked_at, expires_at
        FROM rate_limit_blacklist
        WHERE expires_at IS NULL OR expires_at > NOW()
      `;

      for (const row of rows) {
        const scopeKey = row.scope_key || this.getScopeKey(row.wa_user_id, row.village_id);
        this.data.blacklist[scopeKey] = {
          wa_user_id: row.wa_user_id,
          village_id: row.village_id || undefined,
          scopeKey,
          reason: row.reason,
          addedAt: row.blocked_at.toISOString(),
          addedBy: 'system',
          expiresAt: row.expires_at?.toISOString(),
        };
      }

      if (rows.length > 0) {
        logger.info(`🛡️ Loaded ${rows.length} blacklist entries from DB`);
      }
    } catch (err) {
      logger.warn('Failed to load blacklist from DB (will use empty)', {
        error: (err as Error).message,
      });
    }
  }

  /**
   * Persist blacklist entry to DB (fire-and-forget, Temuan 8)
   */
  private persistBlacklistEntry(scopeKey: string, entry: BlacklistEntry): void {
    const expiresAt = entry.expiresAt ? new Date(entry.expiresAt) : null;
    const violations = this.data.users[scopeKey]?.violations || 0;

    prisma.$executeRaw`
      INSERT INTO rate_limit_blacklist (id, wa_user_id, village_id, scope_key, reason, blocked_at, expires_at, violation_count, created_at, updated_at)
      VALUES (${scopeKey}, ${entry.wa_user_id}, ${entry.village_id || null}, ${scopeKey}, ${entry.reason}, ${new Date(entry.addedAt)}, ${expiresAt}, ${violations}, NOW(), NOW())
      ON CONFLICT (scope_key) DO UPDATE SET
        wa_user_id = EXCLUDED.wa_user_id,
        village_id = EXCLUDED.village_id,
        reason = EXCLUDED.reason,
        expires_at = EXCLUDED.expires_at,
        violation_count = EXCLUDED.violation_count,
        updated_at = NOW()
    `
      .catch((err: Error) => {
        logger.warn('Failed to persist blacklist entry', {
          scopeKey,
          error: err.message,
        });
      });
  }

  /**
   * Remove blacklist entry from DB (fire-and-forget, Temuan 8)
   */
  private removeBlacklistFromDB(scopeKey: string): void {
    prisma.$executeRaw`
      DELETE FROM rate_limit_blacklist WHERE scope_key = ${scopeKey}
    `.catch(() => {}); // Ignore if not found
  }

  /**
   * Start daily reset check (runs every hour)
   */
  private startDailyReset(): void {
    // Check every hour for new day
    registerInterval(() => {
      const today = this.getTodayString();
      let resetCount = 0;
      
      for (const [userId, userData] of Object.entries(this.data.users)) {
        if (userData.date !== today) {
          // Reset daily counts for new day
          userData.dailyReports = 0;
          userData.date = today;
          resetCount++;
        }
      }
      
      if (resetCount > 0) {
        logger.info('🔄 Daily rate limit reset', { resetCount });
      }
      
      // Also clean up expired blacklist entries
      this.cleanupExpiredBlacklist();
    }, 60 * 60 * 1000, 'rate-limiter-daily-reset'); // Every hour
  }

  /**
   * Get today's date string (YYYY-MM-DD)
   */
  private getTodayString(): string {
    return new Date().toISOString().split('T')[0];
  }

  /**
   * Get or create user rate data
   */
  private getUserData(wa_user_id: string, village_id?: string | null): UserRateData {
    const today = this.getTodayString();
    const scopeKey = this.getScopeKey(wa_user_id, village_id);

    if (!this.data.users[scopeKey]) {
      this.data.users[scopeKey] = {
        wa_user_id,
        village_id: village_id || undefined,
        scopeKey,
        dailyReports: 0,
        lastReportTime: 0,
        date: today,
        violations: 0,
      };
    }

    // Reset if new day
    if (this.data.users[scopeKey].date !== today) {
      this.data.users[scopeKey].dailyReports = 0;
      this.data.users[scopeKey].date = today;
    }

    return this.data.users[scopeKey];
  }

  /**
   * Check if user is rate limited
   */
  checkRateLimit(wa_user_id: string, village_id?: string | null): RateLimitResult {
    // Check if rate limiting is disabled
    if (!config.rateLimitEnabled) {
      return { allowed: true, reason: 'disabled' };
    }

    const autoBlacklistViolations = Math.max(1, config.autoBlacklistViolations || 1);

    const scopeKey = this.getScopeKey(wa_user_id, village_id);
    const scope = this.getScopeLabel(village_id);

    // Check blacklist first
    if (this.isBlacklisted(wa_user_id, village_id)) {
      const entry = this.data.blacklist[scopeKey];
      this.blockedCount++;
      logger.warn('🚫 Blocked blacklisted user', {
        wa_user_id,
        scope,
        reason: entry.reason,
      });
      return {
        allowed: false,
        reason: 'blacklisted',
        message: `Nomor Anda diblokir karena: ${entry.reason}`,
      };
    }

    const userData = this.getUserData(wa_user_id, village_id);
    const now = Date.now();

    // Check cooldown (minimum time between reports)
    if (config.cooldownSeconds > 0 && userData.lastReportTime > 0) {
      const timeSinceLastReport = (now - userData.lastReportTime) / 1000;
      if (timeSinceLastReport < config.cooldownSeconds) {
        const remaining = Math.ceil(config.cooldownSeconds - timeSinceLastReport);
        userData.violations++;
        this.blockedCount++;
        
        logger.warn('⏳ User in cooldown period', {
          wa_user_id,
          cooldownRemaining: remaining,
          violations: userData.violations,
        });
        
        // Auto-blacklist if too many violations
        if (userData.violations >= autoBlacklistViolations) {
          this.addToBlacklist(wa_user_id, 'Terlalu banyak pelanggaran rate limit', 'system', undefined, undefined, village_id);
        }
        
        return {
          allowed: false,
          reason: 'cooldown',
          cooldownRemaining: remaining,
          message: `Mohon tunggu ${remaining} detik sebelum mengirim laporan baru.`,
        };
      }
    }

    // Check daily limit
    if (userData.dailyReports >= config.maxReportsPerDay) {
      userData.violations++;
      this.blockedCount++;
      
      logger.warn('🚫 User exceeded daily limit', {
        wa_user_id,
        dailyReports: userData.dailyReports,
        maxReportsPerDay: config.maxReportsPerDay,
        violations: userData.violations,
      });
      
      // Auto-blacklist if too many violations
      if (userData.violations >= autoBlacklistViolations) {
        this.addToBlacklist(wa_user_id, 'Terlalu banyak pelanggaran rate limit', 'system', undefined, undefined, village_id);
      }
      
      return {
        allowed: false,
        reason: 'rate_limit',
        remainingReports: 0,
        message: `Anda telah mencapai batas ${config.maxReportsPerDay} laporan per hari. Silakan coba lagi besok.`,
      };
    }

    // Allowed
    return {
      allowed: true,
      remainingReports: config.maxReportsPerDay - userData.dailyReports,
    };
  }

  /**
   * Record a report submission (call after successful report creation)
   */
  recordReport(wa_user_id: string, village_id?: string | null): void {
    if (!config.rateLimitEnabled) return;

    const userData = this.getUserData(wa_user_id, village_id);
    userData.dailyReports++;
    userData.lastReportTime = Date.now();

    logger.info('📝 Report recorded for rate limit', {
      wa_user_id,
      scope: this.getScopeLabel(village_id),
      dailyReports: userData.dailyReports,
      maxReportsPerDay: config.maxReportsPerDay,
    });
  }

  /**
   * Check if user is blacklisted
   */
  isBlacklisted(wa_user_id: string, village_id?: string | null): boolean {
    const scopeKey = this.getScopeKey(wa_user_id, village_id);
    const entry = this.data.blacklist[scopeKey];
    if (!entry) return false;

    // Check if expired
    if (entry.expiresAt) {
      const expiresAt = new Date(entry.expiresAt);
      if (expiresAt < new Date()) {
        delete this.data.blacklist[scopeKey];
        this.removeBlacklistFromDB(scopeKey);
        return false;
      }
    }

    return true;
  }

  /**
   * Add user to blacklist
   */
  addToBlacklist(
    wa_user_id: string,
    reason: string,
    addedBy: string = 'admin',
    expiresInDays?: number,
    expiresInMs?: number,
    village_id?: string | null,
  ): void {
    let expiresAt: string | undefined;
    const scopeKey = this.getScopeKey(wa_user_id, village_id);

    if (expiresInMs) {
      expiresAt = new Date(Date.now() + expiresInMs).toISOString();
    } else if (expiresInDays) {
      expiresAt = new Date(Date.now() + expiresInDays * 24 * 60 * 60 * 1000).toISOString();
    }

    this.data.blacklist[scopeKey] = {
      wa_user_id,
      village_id: village_id || undefined,
      scopeKey,
      reason,
      addedAt: new Date().toISOString(),
      addedBy,
      expiresAt,
    };

    // Persist to DB (Temuan 8)
    this.persistBlacklistEntry(scopeKey, this.data.blacklist[scopeKey]);

    logger.warn('🚫 User added to blacklist', {
      wa_user_id,
      scope: this.getScopeLabel(village_id),
      reason,
      addedBy,
      expiresAt,
    });
  }

  /**
   * Remove user from blacklist
   */
  removeFromBlacklist(wa_user_id: string, village_id?: string | null): boolean {
    const scopeKey = this.getScopeKey(wa_user_id, village_id);
    if (this.data.blacklist[scopeKey]) {
      delete this.data.blacklist[scopeKey];
      this.removeBlacklistFromDB(scopeKey); // Temuan 8
      this.resetUserViolations(wa_user_id, village_id);
      logger.info('✅ User removed from blacklist', { wa_user_id, scope: this.getScopeLabel(village_id) });
      return true;
    }
    return false;
  }

  /**
   * Get blacklist entries
   */
  getBlacklist(village_id?: string | null): BlacklistEntry[] {
    const entries = Object.values(this.data.blacklist);
    if (village_id === undefined) return entries;
    return entries.filter(entry => (entry.village_id || null) === (village_id || null));
  }

  /**
   * Cleanup expired blacklist entries
   */
  private cleanupExpiredBlacklist(): void {
    const now = new Date();
    let cleaned = 0;
    
    for (const [userId, entry] of Object.entries(this.data.blacklist)) {
      if (entry.expiresAt && new Date(entry.expiresAt) < now) {
        delete this.data.blacklist[userId];
        cleaned++;
      }
    }
    
    if (cleaned > 0) {
      logger.info('🧹 Cleaned expired blacklist entries', { count: cleaned });
    }
  }

  /**
   * Get rate limit statistics
   */
  getStats(village_id?: string | null): RateLimitStats {
    const users = Object.values(this.data.users)
      .filter(user => village_id === undefined || (user.village_id || null) === (village_id || null));
    const blacklist = this.getBlacklist(village_id);

    // Sort by violations desc
    const topViolators = users
      .filter(u => u.violations > 0)
      .sort((a, b) => b.violations - a.violations)
      .slice(0, 10)
      .map(u => ({
        wa_user_id: u.wa_user_id,
        violations: u.violations,
        dailyReports: u.dailyReports,
      }));

    return {
      totalBlocked: this.blockedCount,
      totalBlacklisted: blacklist.length,
      activeUsers: users.filter(u => u.dailyReports > 0).length,
      topViolators,
    };
  }

  /**
   * Get user rate limit info
   */
  getUserInfo(wa_user_id: string, village_id?: string | null): UserRateData | null {
    return this.data.users[this.getScopeKey(wa_user_id, village_id)] || null;
  }

  /**
   * Reset user violations (for admin)
   */
  resetUserViolations(wa_user_id: string, village_id?: string | null): boolean {
    const scopeKey = this.getScopeKey(wa_user_id, village_id);
    if (this.data.users[scopeKey]) {
      this.data.users[scopeKey].violations = 0;
      return true;
    }
    return false;
  }

}

// Export singleton
export const rateLimiterService = new RateLimiterService();
