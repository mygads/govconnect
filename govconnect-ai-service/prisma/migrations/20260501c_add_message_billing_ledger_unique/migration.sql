SET search_path TO ai;

CREATE UNIQUE INDEX IF NOT EXISTS "ai_message_billings_ledger_entry_id_key"
  ON "ai_message_billings" ("ledger_entry_id");
