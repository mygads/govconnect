import axios from 'axios';
import logger from '../utils/logger';
import { config } from '../config/env';

interface SystemSettings {
  ai_chatbot_enabled: string;
  ai_model_primary: string;
  ai_model_fallback: string;
}

// Cache settings for performance (refresh every 60 seconds)
let cachedSettings: SystemSettings | null = null;
let lastFetchTime = 0;
const CACHE_TTL_MS = 60000; // 1 minute

/**
 * Get system settings from dashboard service
 */
export async function getSettings(): Promise<SystemSettings> {
  const now = Date.now();
  
  // Return cached settings if still valid
  if (cachedSettings && (now - lastFetchTime) < CACHE_TTL_MS) {
    return cachedSettings;
  }

  try {
    logger.debug('Fetching system settings from dashboard');

    const response = await axios.get<{ data: SystemSettings }>(
      `${config.dashboardServiceUrl}/api/internal/settings`,
      {
        headers: {
          'x-internal-api-key': config.internalApiKey,
        },
        timeout: 5000,
      }
    );

    cachedSettings = response.data.data;
    lastFetchTime = now;

    logger.info('System settings loaded', {
      aiEnabled: cachedSettings.ai_chatbot_enabled,
    });

    return cachedSettings;
  } catch (error: any) {
    logger.error('Failed to fetch settings, using defaults', {
      error: error.message,
    });

    // Return defaults if fetch fails
    return {
      ai_chatbot_enabled: 'true',
      ai_model_primary: 'gemini-2.5-flash',
      ai_model_fallback: 'gemini-2.0-flash',
    };
  }
}

/**
 * Check if AI chatbot is enabled
 */
export async function isAIChatbotEnabled(): Promise<boolean> {
  const settings = await getSettings();
  return settings.ai_chatbot_enabled === 'true';
}

/**
 * Get specific setting value
 */
export async function getSetting(key: string): Promise<string | null> {
  try {
    const response = await axios.get<{ key: string; value: string }>(
      `${config.dashboardServiceUrl}/api/internal/settings`,
      {
        params: { key },
        headers: {
          'x-internal-api-key': config.internalApiKey,
        },
        timeout: 5000,
      }
    );

    return response.data.value;
  } catch (error: any) {
    logger.error('Failed to get setting', {
      key,
      error: error.message,
    });

    return null;
  }
}

/**
 * Clear settings cache (useful for testing or force refresh)
 */
export function clearSettingsCache(): void {
  cachedSettings = null;
  lastFetchTime = 0;
}
