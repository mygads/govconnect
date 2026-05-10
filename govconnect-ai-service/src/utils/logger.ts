import winston from 'winston';

const logLevel = process.env.LOG_LEVEL || 'info';
const logDir = process.env.LOG_DIR || 'logs';

// ── PII redaction ──────────────────────────────────────────────────────
// Redact sensitive fields at log time so nothing sensitive lands in logs
// even if a caller forgets to sanitize. Production-critical: nomor HP,
// NIK, alamat lengkap, token pembayaran / edit tokens.
const PII_FIELD_NAMES = new Set([
  'wa_user_id', 'waUserId', 'phone', 'phoneNumber', 'no_hp', 'noHp', 'nomor_hp',
  'reporter_phone', 'reporterPhone', 'user_phone', 'userPhone',
  'nik', 'ktp', 'identity_number', 'identityNumber',
  'edit_token', 'editToken', 'token',
  'email', 'password', 'authorization', 'x-internal-api-key',
]);

const PII_ADDRESS_FIELDS = new Set([
  'alamat', 'address', 'full_address', 'fullAddress',
  'reporter_address', 'reporterAddress',
]);

function maskPhone(value: string): string {
  const digits = value.replace(/\D/g, '');
  if (digits.length < 6) return '***';
  return `${digits.slice(0, 3)}***${digits.slice(-3)}`;
}

function maskGeneric(value: string): string {
  if (!value) return '***';
  if (value.length <= 4) return '***';
  return `${value.slice(0, 2)}***${value.slice(-2)}`;
}

function maskAddress(value: string): string {
  if (!value) return '***';
  const words = value.trim().split(/\s+/);
  if (words.length <= 2) return '***';
  return `${words.slice(0, 2).join(' ')} …`;
}

function redactValue(key: string, value: unknown, depth: number): unknown {
  if (value === null || value === undefined) return value;
  if (depth > 5) return '[depth-limit]';

  const lowerKey = key.toLowerCase();

  if (PII_FIELD_NAMES.has(key) || PII_FIELD_NAMES.has(lowerKey)) {
    if (typeof value === 'string') {
      if (/phone|hp|wa/i.test(lowerKey) || /^(\+?62|0)\d{6,}$/.test(value.replace(/\D/g, ''))) {
        return maskPhone(value);
      }
      return maskGeneric(value);
    }
    return '[redacted]';
  }

  if (PII_ADDRESS_FIELDS.has(key) || PII_ADDRESS_FIELDS.has(lowerKey)) {
    return typeof value === 'string' ? maskAddress(value) : '[redacted]';
  }

  if (typeof value === 'string') {
    // In-string masks for phone / NIK patterns so inline logs also get scrubbed.
    let scrubbed = value
      .replace(/\b(\+?62|0)\d{2,3}[-.\s]?\d{3,4}[-.\s]?\d{3,4}\b/g, (m) => maskPhone(m))
      .replace(/\b\d{16}\b/g, '****-****-****-****');
    return scrubbed;
  }

  if (Array.isArray(value)) {
    return value.map((item, idx) => redactValue(String(idx), item, depth + 1));
  }

  if (typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = redactValue(k, v, depth + 1);
    }
    return out;
  }

  return value;
}

const piiRedactionFormat = winston.format((info) => {
  for (const key of Object.keys(info)) {
    if (key === 'level' || key === 'message' || key === 'timestamp') continue;
    info[key] = redactValue(key, info[key], 0);
  }
  // Also scrub message string for inline PII.
  if (typeof info.message === 'string') {
    info.message = redactValue('message', info.message, 0) as string;
  }
  return info;
});

const logger = winston.createLogger({
  level: logLevel,
  format: winston.format.combine(
    piiRedactionFormat(),
    winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
    winston.format.errors({ stack: true }),
    winston.format.json()
  ),
  defaultMeta: { service: 'ai-orchestrator' },
  transports: [
    new winston.transports.Console({
      format: winston.format.combine(
        winston.format.colorize(),
        winston.format.printf(({ timestamp, level, message, ...meta }) => {
          const metaStr = Object.keys(meta).length ? JSON.stringify(meta) : '';
          return `${timestamp} [${level}]: ${message} ${metaStr}`;
        })
      ),
    }),
    new winston.transports.File({
      filename: `${logDir}/error.log`,
      level: 'error',
      maxsize: 5242880, // 5MB
      maxFiles: 5,
    }),
    new winston.transports.File({
      filename: `${logDir}/combined.log`,
      maxsize: 5242880,
      maxFiles: 5,
    }),
  ],
});

export default logger;
