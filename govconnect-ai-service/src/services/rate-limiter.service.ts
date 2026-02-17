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

interface UserRateData {
  wa_user_id: string;
  dailyReports: number;
  lastReportTime: number; // Unix timestamp
  date: string; // YYYY-MM-DD
  violations: number; // Number of rate limit violations
}

interface BlacklistEntry {
  wa_user_id: string;
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
    logger.info('🛡️ Rate Limiter Service initialized (in-memory)', {
      enabled: config.rateLimitEnabled,
      maxReportsPerDay: config.maxReportsPerDay,
      cooldownSeconds: config.cooldownSeconds,
    });
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
  private getUserData(wa_user_id: string): UserRateData {
    const today = this.getTodayString();
    
    if (!this.data.users[wa_user_id]) {
      this.data.users[wa_user_id] = {
        wa_user_id,
        dailyReports: 0,
        lastReportTime: 0,
        date: today,
        violations: 0,
      };
    }
    
    // Reset if new day
    if (this.data.users[wa_user_id].date !== today) {
      this.data.users[wa_user_id].dailyReports = 0;
      this.data.users[wa_user_id].date = today;
    }
    
    return this.data.users[wa_user_id];
  }

  /**
   * Check if user is rate limited
   */
  checkRateLimit(wa_user_id: string): RateLimitResult {
    // Check if rate limiting is disabled
    if (!config.rateLimitEnabled) {
      return { allowed: true, reason: 'disabled' };
    }

    // Check blacklist first
    if (this.isBlacklisted(wa_user_id)) {
      const entry = this.data.blacklist[wa_user_id];
      this.blockedCount++;
      logger.warn('🚫 Blocked blacklisted user', {
        wa_user_id,
        reason: entry.reason,
      });
      return {
        allowed: false,
        reason: 'blacklisted',
        message: `Nomor Anda diblokir karena: ${entry.reason}`,
      };
    }

    const userData = this.getUserData(wa_user_id);
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
        if (userData.violations >= 10) {
          this.addToBlacklist(wa_user_id, 'Terlalu banyak pelanggaran rate limit', 'system');
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
      if (userData.violations >= 10) {
        this.addToBlacklist(wa_user_id, 'Terlalu banyak pelanggaran rate limit', 'system');
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
  recordReport(wa_user_id: string): void {
    if (!config.rateLimitEnabled) return;
    
    const userData = this.getUserData(wa_user_id);
    userData.dailyReports++;
    userData.lastReportTime = Date.now();
    
    logger.info('📝 Report recorded for rate limit', {
      wa_user_id,
      dailyReports: userData.dailyReports,
      maxReportsPerDay: config.maxReportsPerDay,
    });
  }

  /**
   * Check if user is blacklisted
   */
  isBlacklisted(wa_user_id: string): boolean {
    const entry = this.data.blacklist[wa_user_id];
    if (!entry) return false;
    
    // Check if expired
    if (entry.expiresAt) {
      const expiresAt = new Date(entry.expiresAt);
      if (expiresAt < new Date()) {
        // Expired, remove from blacklist
        delete this.data.blacklist[wa_user_id];
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
  ): void {
    let expiresAt: string | undefined;
    
    if (expiresInMs) {
      expiresAt = new Date(Date.now() + expiresInMs).toISOString();
    } else if (expiresInDays) {
      expiresAt = new Date(Date.now() + expiresInDays * 24 * 60 * 60 * 1000).toISOString();
    }
    
    this.data.blacklist[wa_user_id] = {
      wa_user_id,
      reason,
      addedAt: new Date().toISOString(),
      addedBy,
      expiresAt,
    };
    
    logger.warn('🚫 User added to blacklist', {
      wa_user_id,
      reason,
      addedBy,
      expiresAt,
    });
  }

  /**
   * Remove user from blacklist
   */
  removeFromBlacklist(wa_user_id: string): boolean {
    if (this.data.blacklist[wa_user_id]) {
      delete this.data.blacklist[wa_user_id];
      logger.info('✅ User removed from blacklist', { wa_user_id });
      return true;
    }
    return false;
  }

  /**
   * Get blacklist entries
   */
  getBlacklist(): BlacklistEntry[] {
    return Object.values(this.data.blacklist);
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
  getStats(): RateLimitStats {
    const users = Object.values(this.data.users);
    
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
      totalBlacklisted: Object.keys(this.data.blacklist).length,
      activeUsers: users.filter(u => u.dailyReports > 0).length,
      topViolators,
    };
  }

  /**
   * Get user rate limit info
   */
  getUserInfo(wa_user_id: string): UserRateData | null {
    return this.data.users[wa_user_id] || null;
  }

  /**
   * Reset user violations (for admin)
   */
  resetUserViolations(wa_user_id: string): boolean {
    if (this.data.users[wa_user_id]) {
      this.data.users[wa_user_id].violations = 0;
      return true;
    }
    return false;
  }

}

// Export singleton
export const rateLimiterService = new RateLimiterService();
