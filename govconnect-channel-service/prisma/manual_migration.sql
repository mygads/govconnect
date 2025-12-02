-- Channel Service Migration
SET search_path TO channel;

-- Messages table
CREATE TABLE IF NOT EXISTS messages (
  id TEXT PRIMARY KEY,
  wa_user_id TEXT NOT NULL,
  message_id TEXT UNIQUE NOT NULL,
  message_text TEXT NOT NULL,
  direction TEXT NOT NULL,
  source TEXT NOT NULL,
  timestamp TIMESTAMP DEFAULT NOW(),
  "createdAt" TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_messages_wa_user_timestamp ON messages(wa_user_id, timestamp);
CREATE INDEX IF NOT EXISTS idx_messages_direction ON messages(direction);
CREATE INDEX IF NOT EXISTS idx_messages_message_id ON messages(message_id);

-- Send logs table
CREATE TABLE IF NOT EXISTS send_logs (
  id TEXT PRIMARY KEY,
  wa_user_id TEXT NOT NULL,
  message_text TEXT NOT NULL,
  status TEXT NOT NULL,
  error_msg TEXT,
  timestamp TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_send_logs_wa_user_id ON send_logs(wa_user_id);
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
  wa_user_id TEXT NOT NULL,
  admin_id TEXT NOT NULL,
  admin_name TEXT,
  started_at TIMESTAMP DEFAULT NOW(),
  ended_at TIMESTAMP,
  reason TEXT
);

CREATE INDEX IF NOT EXISTS idx_takeover_sessions_wa_user_id ON takeover_sessions(wa_user_id);
CREATE INDEX IF NOT EXISTS idx_takeover_sessions_admin_id ON takeover_sessions(admin_id);
CREATE INDEX IF NOT EXISTS idx_takeover_sessions_started_at ON takeover_sessions(started_at);
CREATE INDEX IF NOT EXISTS idx_takeover_sessions_wa_user_ended ON takeover_sessions(wa_user_id, ended_at);

-- Conversations table - summary for live chat list
CREATE TABLE IF NOT EXISTS conversations (
  id TEXT PRIMARY KEY,
  wa_user_id TEXT UNIQUE NOT NULL,
  user_name TEXT,
  last_message TEXT,
  last_message_at TIMESTAMP DEFAULT NOW(),
  unread_count INT DEFAULT 0,
  is_takeover BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_conversations_is_takeover ON conversations(is_takeover);
CREATE INDEX IF NOT EXISTS idx_conversations_last_message_at ON conversations(last_message_at);
