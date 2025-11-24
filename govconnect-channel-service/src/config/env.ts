import dotenv from 'dotenv';

dotenv.config();

interface EnvConfig {
  NODE_ENV: string;
  PORT: number;
  DATABASE_URL: string;
  RABBITMQ_URL: string;
  INTERNAL_API_KEY: string;
  WA_API_URL: string;
  WA_PHONE_NUMBER_ID: string;
  WA_ACCESS_TOKEN: string;
  WA_WEBHOOK_VERIFY_TOKEN: string;
  LOG_LEVEL: string;
  LOG_DIR: string;
  CASE_SERVICE_URL: string;
  NOTIFICATION_SERVICE_URL: string;
}

function validateEnv(): EnvConfig {
  const required = [
    'DATABASE_URL',
    'RABBITMQ_URL',
    'INTERNAL_API_KEY',
    'WA_WEBHOOK_VERIFY_TOKEN',
  ];

  for (const key of required) {
    if (!process.env[key]) {
      throw new Error(`Missing required environment variable: ${key}`);
    }
  }

  return {
    NODE_ENV: process.env.NODE_ENV || 'development',
    PORT: parseInt(process.env.PORT || '3001', 10),
    DATABASE_URL: process.env.DATABASE_URL!,
    RABBITMQ_URL: process.env.RABBITMQ_URL!,
    INTERNAL_API_KEY: process.env.INTERNAL_API_KEY!,
    WA_API_URL: process.env.WA_API_URL || 'https://graph.facebook.com/v21.0',
    WA_PHONE_NUMBER_ID: process.env.WA_PHONE_NUMBER_ID || '',
    WA_ACCESS_TOKEN: process.env.WA_ACCESS_TOKEN || '',
    WA_WEBHOOK_VERIFY_TOKEN: process.env.WA_WEBHOOK_VERIFY_TOKEN!,
    LOG_LEVEL: process.env.LOG_LEVEL || 'info',
    LOG_DIR: process.env.LOG_DIR || 'logs',
    CASE_SERVICE_URL: process.env.CASE_SERVICE_URL || 'http://localhost:3003',
    NOTIFICATION_SERVICE_URL: process.env.NOTIFICATION_SERVICE_URL || 'http://localhost:3004',
  };
}

export const config = validateEnv();
