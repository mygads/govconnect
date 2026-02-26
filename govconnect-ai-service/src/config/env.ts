import logger from '../utils/logger';

interface Config {
  port: number;
  nodeEnv: string;
  geminiApiKey: string;
  rabbitmqUrl: string;
  channelServiceUrl: string;
  caseServiceUrl: string;
  dashboardServiceUrl: string;
  internalApiKey: string;
  llmTemperature: number;
  llmMaxTokens: number;
  llmTimeoutMs: number;
  maxHistoryMessages: number;
  // Rate limiting
  rateLimitEnabled: boolean;
  maxReportsPerDay: number;
  cooldownSeconds: number;
  autoBlacklistViolations: number;
  // Testing mode
  testingMode: boolean;
}

function validateEnv(): Config {
  const requiredEnvVars = [
    'GEMINI_API_KEY',
    'RABBITMQ_URL',
    'CHANNEL_SERVICE_URL',
    'CASE_SERVICE_URL',
    'INTERNAL_API_KEY',
  ];

  const missing = requiredEnvVars.filter(key => !process.env[key]);
  
  if (missing.length > 0) {
    logger.error('❌ Missing required environment variables', { missing });
    throw new Error(`Missing required environment variables: ${missing.join(', ')}`);
  }

  const config: Config = {
    port: parseInt(process.env.PORT || '3002', 10),
    nodeEnv: process.env.NODE_ENV || 'development',
    geminiApiKey: process.env.GEMINI_API_KEY!,
    rabbitmqUrl: process.env.RABBITMQ_URL!,
    channelServiceUrl: process.env.CHANNEL_SERVICE_URL!,
    caseServiceUrl: process.env.CASE_SERVICE_URL!,
    dashboardServiceUrl: process.env.DASHBOARD_SERVICE_URL || 'http://dashboard:3000',
    internalApiKey: process.env.INTERNAL_API_KEY!,
    llmTemperature: parseFloat(process.env.LLM_TEMPERATURE || '0.3'),
    llmMaxTokens: parseInt(process.env.LLM_MAX_TOKENS || '3072', 10),
    llmTimeoutMs: parseInt(process.env.LLM_TIMEOUT_MS || '30000', 10),
    maxHistoryMessages: parseInt(process.env.MAX_HISTORY_MESSAGES || '30', 10),
    // Rate limiting - defaults: enabled with 5 reports/day, 30s cooldown
    rateLimitEnabled: process.env.RATE_LIMIT_ENABLED !== 'false', // Default: true
    maxReportsPerDay: parseInt(process.env.MAX_REPORTS_PER_DAY || '5', 10),
    cooldownSeconds: parseInt(process.env.COOLDOWN_SECONDS || '30', 10),
    autoBlacklistViolations: parseInt(process.env.AUTO_BLACKLIST_VIOLATIONS || '10', 10),
    // Testing mode - defaults: false (production mode)
    testingMode: process.env.TESTING_MODE === 'true', // Default: false
  };

  logger.info('✅ Environment configuration validated', {
    port: config.port,
    nodeEnv: config.nodeEnv,
    rateLimitEnabled: config.rateLimitEnabled,
    maxReportsPerDay: config.maxReportsPerDay,
    cooldownSeconds: config.cooldownSeconds,
    testingMode: config.testingMode,
  });

  return config;
}

export const config = validateEnv();
