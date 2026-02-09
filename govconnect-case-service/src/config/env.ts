import dotenv from 'dotenv';

dotenv.config();

interface EnvironmentConfig {
  nodeEnv: string;
  port: number;
  databaseUrl: string;
  rabbitmqUrl: string;
  internalApiKey: string;
  logLevel: string;
  logDir: string;
  idPrefixComplaint: string;
  idPrefixServiceRequest: string;
  geminiApiKey: string;
  microNluModels: string[];
  aiServiceUrl: string;
}

function parseMicroNluModels(envValue?: string): string[] {
  const defaults = ['gemini-2.0-flash-lite', 'gemini-2.5-flash-lite'];
  const raw = (envValue || '').trim();
  if (!raw) return defaults;
  const models = raw.split(',').map(m => m.trim()).filter(Boolean);
  return models.length > 0 ? models : defaults;
}

function validateEnv(): EnvironmentConfig {
  const required = [
    'DATABASE_URL',
    'RABBITMQ_URL',
    'INTERNAL_API_KEY',
  ];

  const missing = required.filter((key) => !process.env[key]);

  if (missing.length > 0) {
    console.error('❌ Missing required environment variables:', missing.join(', '));
    throw new Error(`Missing required environment variables: ${missing.join(', ')}`);
  }

  return {
    nodeEnv: process.env.NODE_ENV || 'development',
    port: parseInt(process.env.PORT || '3003', 10),
    databaseUrl: process.env.DATABASE_URL!,
    rabbitmqUrl: process.env.RABBITMQ_URL!,
    internalApiKey: process.env.INTERNAL_API_KEY!,
    logLevel: process.env.LOG_LEVEL || 'info',
    logDir: process.env.LOG_DIR || 'logs',
    idPrefixComplaint: process.env.ID_PREFIX_COMPLAINT || 'LAP',
    idPrefixServiceRequest: process.env.ID_PREFIX_SERVICE_REQUEST || 'LAY',
    geminiApiKey: process.env.GEMINI_API_KEY || '',
    microNluModels: parseMicroNluModels(process.env.MICRO_NLU_MODELS),
    aiServiceUrl: process.env.AI_SERVICE_URL || 'http://ai-service:3002',
  };
}

export const config = validateEnv();
