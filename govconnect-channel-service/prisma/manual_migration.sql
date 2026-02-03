-- Channel Service Migration
SET search_path TO channel;

-- Messages table
CREATE TABLE IF NOT EXISTS messages (
  id TEXT PRIMARY KEY,
  village_id TEXT NOT NULL DEFAULT 'default',
  wa_user_id TEXT NOT NULL,
  message_id TEXT UNIQUE NOT NULL,
  message_text TEXT NOT NULL,
  direction TEXT NOT NULL,
  source TEXT NOT NULL,
  timestamp TIMESTAMP DEFAULT NOW(),
  "createdAt" TIMESTAMP DEFAULT NOW()
);

ALTER TABLE messages ADD COLUMN IF NOT EXISTS village_id TEXT NOT NULL DEFAULT 'default';

DROP INDEX IF EXISTS idx_messages_wa_user_timestamp;
CREATE INDEX IF NOT EXISTS idx_messages_village_wa_user_timestamp ON messages(village_id, wa_user_id, timestamp);
CREATE INDEX IF NOT EXISTS idx_messages_direction ON messages(direction);
CREATE INDEX IF NOT EXISTS idx_messages_message_id ON messages(message_id);

-- Send logs table
CREATE TABLE IF NOT EXISTS send_logs (
  id TEXT PRIMARY KEY,
  village_id TEXT NOT NULL DEFAULT 'default',
  wa_user_id TEXT NOT NULL,
  message_text TEXT NOT NULL,
  status TEXT NOT NULL,
  error_msg TEXT,
  timestamp TIMESTAMP DEFAULT NOW()
);

ALTER TABLE send_logs ADD COLUMN IF NOT EXISTS village_id TEXT NOT NULL DEFAULT 'default';

DROP INDEX IF EXISTS idx_send_logs_wa_user_id;
CREATE INDEX IF NOT EXISTS idx_send_logs_village_wa_user_id ON send_logs(village_id, wa_user_id);
CREATE INDEX IF NOT EXISTS idx_send_logs_status ON send_logs(status);
CREATE INDEX IF NOT EXISTS idx_send_logs_timestamp ON send_logs(timestamp);

-- WhatsApp settings table
CREATE TABLE IF NOT EXISTS wa_settings (
  id TEXT PRIMARY KEY DEFAULT 'default',
  auto_read_messages BOOLEAN DEFAULT FALSE,
  typing_indicator BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

-- Takeover sessions table - when admin takes over conversation from AI
CREATE TABLE IF NOT EXISTS takeover_sessions (
  id TEXT PRIMARY KEY,
  village_id TEXT NOT NULL DEFAULT 'default',
  wa_user_id TEXT NOT NULL,
  admin_id TEXT NOT NULL,
  admin_name TEXT,
  started_at TIMESTAMP DEFAULT NOW(),
  ended_at TIMESTAMP,
  reason TEXT
);

ALTER TABLE takeover_sessions ADD COLUMN IF NOT EXISTS village_id TEXT NOT NULL DEFAULT 'default';

DROP INDEX IF EXISTS idx_takeover_sessions_wa_user_id;
CREATE INDEX IF NOT EXISTS idx_takeover_sessions_village_wa_user_id ON takeover_sessions(village_id, wa_user_id);
CREATE INDEX IF NOT EXISTS idx_takeover_sessions_admin_id ON takeover_sessions(admin_id);
CREATE INDEX IF NOT EXISTS idx_takeover_sessions_started_at ON takeover_sessions(started_at);
DROP INDEX IF EXISTS idx_takeover_sessions_wa_user_ended;
CREATE INDEX IF NOT EXISTS idx_takeover_sessions_village_wa_user_ended ON takeover_sessions(village_id, wa_user_id, ended_at);

-- Conversations table - summary for live chat list
CREATE TABLE IF NOT EXISTS conversations (
  id TEXT PRIMARY KEY,
  village_id TEXT NOT NULL DEFAULT 'default',
  wa_user_id TEXT NOT NULL,
  user_name TEXT,
  last_message TEXT,
  last_message_at TIMESTAMP DEFAULT NOW(),
  unread_count INT DEFAULT 0,
  is_takeover BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

ALTER TABLE conversations ADD COLUMN IF NOT EXISTS village_id TEXT NOT NULL DEFAULT 'default';
ALTER TABLE conversations DROP CONSTRAINT IF EXISTS conversations_wa_user_id_key;
CREATE UNIQUE INDEX IF NOT EXISTS idx_conversations_village_wa_user_unique ON conversations(village_id, wa_user_id);
CREATE INDEX IF NOT EXISTS idx_conversations_village_id ON conversations(village_id);

CREATE INDEX IF NOT EXISTS idx_conversations_is_takeover ON conversations(is_takeover);
CREATE INDEX IF NOT EXISTS idx_conversations_last_message_at ON conversations(last_message_at);

-- Add user_phone column for webchat users
ALTER TABLE conversations ADD COLUMN IF NOT EXISTS user_phone TEXT;

-- Pending messages queue (batching/retry)
CREATE TABLE IF NOT EXISTS pending_messages (
  id TEXT PRIMARY KEY,
  village_id TEXT NOT NULL DEFAULT 'default',
  wa_user_id TEXT NOT NULL,
  message_id TEXT UNIQUE NOT NULL,
  message_text TEXT NOT NULL,
  status TEXT DEFAULT 'pending',
  retry_count INT DEFAULT 0,
  error_msg TEXT,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

ALTER TABLE pending_messages ADD COLUMN IF NOT EXISTS village_id TEXT NOT NULL DEFAULT 'default';
CREATE INDEX IF NOT EXISTS idx_pending_messages_village_wa_user_status ON pending_messages(village_id, wa_user_id, status);
CREATE INDEX IF NOT EXISTS idx_pending_messages_status_created ON pending_messages(status, created_at);
