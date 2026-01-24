import dotenv from 'dotenv';

dotenv.config();

interface EnvConfig {
  NODE_ENV: string;
  PORT: number;
  DATABASE_URL: string;
  RABBITMQ_URL: string;
  INTERNAL_API_KEY: string;
  GENFITY_APP_API_URL: string;
  GENFITY_APP_CUSTOMER_API_KEY: string;
  WA_API_URL: string;
  WA_ACCESS_TOKEN: string;
  WA_WEBHOOK_VERIFY_TOKEN: string; // Optional - if empty, webhook verification is disabled
  LOG_LEVEL: string;
  LOG_DIR: string;
  CASE_SERVICE_URL: string;
  NOTIFICATION_SERVICE_URL: string;
  DEFAULT_VILLAGE_ID: string;
}

function validateEnv(): EnvConfig {
  const required = [
    'DATABASE_URL',
    'RABBITMQ_URL',
    'INTERNAL_API_KEY',
    // WA_WEBHOOK_VERIFY_TOKEN removed from required - now optional
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
    // Genfity App Customer API (API-key based) for WhatsApp session management
    // Examples:
    // - https://genfity.com
    // - https://genfity.com/api/customer-api
    GENFITY_APP_API_URL: process.env.GENFITY_APP_API_URL || '',
    // API key used as: Authorization: Bearer gf_...
    GENFITY_APP_CUSTOMER_API_KEY: process.env.GENFITY_APP_CUSTOMER_API_KEY || '',
    // WA_API_URL: WhatsApp provider base URL (includes /wa prefix)
    WA_API_URL: process.env.WA_API_URL || 'https://wa-api.genfity.com/wa',
    // WA_ACCESS_TOKEN: Session token from genfity-wa
    WA_ACCESS_TOKEN: process.env.WA_ACCESS_TOKEN || '',
    // WA_WEBHOOK_VERIFY_TOKEN: Optional - if empty, accepts any webhook without verification
    WA_WEBHOOK_VERIFY_TOKEN: process.env.WA_WEBHOOK_VERIFY_TOKEN || '',
    LOG_LEVEL: process.env.LOG_LEVEL || 'info',
    LOG_DIR: process.env.LOG_DIR || 'logs',
    CASE_SERVICE_URL: process.env.CASE_SERVICE_URL || 'http://localhost:3003',
    NOTIFICATION_SERVICE_URL: process.env.NOTIFICATION_SERVICE_URL || 'http://localhost:3004',
    DEFAULT_VILLAGE_ID: process.env.DEFAULT_VILLAGE_ID || '',
  };
}

export const config = validateEnv();
