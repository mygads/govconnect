import logger from '../utils/logger';

interface Config {
  port: number;
  nodeEnv: string;
  geminiApiKey: string;
  rabbitmqUrl: string;
  channelServiceUrl: string;
  caseServiceUrl: string;
  internalApiKey: string;
  llmModel: string;
  llmTemperature: number;
  llmMaxTokens: number;
  llmTimeoutMs: number;
  maxHistoryMessages: number;
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
    internalApiKey: process.env.INTERNAL_API_KEY!,
    llmModel: process.env.LLM_MODEL || 'gemini-1.5-flash',
    llmTemperature: parseFloat(process.env.LLM_TEMPERATURE || '0.3'),
    llmMaxTokens: parseInt(process.env.LLM_MAX_TOKENS || '1000', 10),
    llmTimeoutMs: parseInt(process.env.LLM_TIMEOUT_MS || '30000', 10),
    maxHistoryMessages: parseInt(process.env.MAX_HISTORY_MESSAGES || '30', 10),
  };

  logger.info('✅ Environment configuration validated', {
    port: config.port,
    nodeEnv: config.nodeEnv,
    llmModel: config.llmModel,
  });

  return config;
}

export const config = validateEnv();
