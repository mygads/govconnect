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
