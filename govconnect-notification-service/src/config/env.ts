import dotenv from 'dotenv';

dotenv.config();

interface Config {
  nodeEnv: string;
  port: number;
  databaseUrl: string;
  rabbitmqUrl: string;
  channelServiceUrl: string;
  internalApiKey: string;
  logLevel: string;
  logDir: string;
}

function validateEnv(): Config {
  const requiredVars = [
    'DATABASE_URL',
    'RABBITMQ_URL',
    'CHANNEL_SERVICE_URL',
    'INTERNAL_API_KEY'
  ];

  const missing = requiredVars.filter(varName => !process.env[varName]);

  if (missing.length > 0) {
    console.error(`❌ Missing required environment variables: ${missing.join(', ')}`);
    throw new Error(`Missing required environment variables: ${missing.join(', ')}`);
  }

  return {
    nodeEnv: process.env.NODE_ENV || 'development',
    port: parseInt(process.env.PORT || '3004', 10),
    databaseUrl: process.env.DATABASE_URL!,
    rabbitmqUrl: process.env.RABBITMQ_URL!,
    channelServiceUrl: process.env.CHANNEL_SERVICE_URL!,
    internalApiKey: process.env.INTERNAL_API_KEY!,
    logLevel: process.env.LOG_LEVEL || 'info',
    logDir: process.env.LOG_DIR || './logs'
  };
}

const config = validateEnv();

export default config;
