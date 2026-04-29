// Minimum env vars so config/env.ts doesn't crash during test imports.
process.env.RABBITMQ_URL ??= 'amqp://localhost';
process.env.CHANNEL_SERVICE_URL ??= 'http://localhost:0';
process.env.CASE_SERVICE_URL ??= 'http://localhost:0';
process.env.INTERNAL_API_KEY ??= 'test-key';
process.env.AI_PROVIDER_ENCRYPTION_KEY ??= '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
process.env.NODE_ENV ??= 'test';
