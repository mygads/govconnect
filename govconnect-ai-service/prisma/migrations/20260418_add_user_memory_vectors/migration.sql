-- Add semantic vector store for episodic user memories

CREATE TABLE IF NOT EXISTS user_memory_vectors (
  id TEXT PRIMARY KEY,
  memory_entry_id TEXT NOT NULL UNIQUE,
  wa_user_id TEXT NOT NULL,
  village_id TEXT,
  memory_type TEXT NOT NULL,
  content TEXT NOT NULL,
  importance DOUBLE PRECISION NOT NULL DEFAULT 0.5,
  embedding vector(768) NOT NULL,
  embedding_model TEXT NOT NULL DEFAULT 'openai/text-embedding-3-small',
  created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT user_memory_vectors_memory_entry_id_fkey
    FOREIGN KEY (memory_entry_id) REFERENCES user_memory_entries(id)
    ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX IF NOT EXISTS user_memory_vectors_wa_user_id_idx
  ON user_memory_vectors (wa_user_id);

CREATE INDEX IF NOT EXISTS user_memory_vectors_wa_user_id_memory_type_idx
  ON user_memory_vectors (wa_user_id, memory_type);

CREATE INDEX IF NOT EXISTS user_memory_vectors_village_id_idx
  ON user_memory_vectors (village_id);

CREATE INDEX IF NOT EXISTS user_memory_vectors_embedding_hnsw_idx
  ON user_memory_vectors
  USING hnsw (embedding vector_cosine_ops)
  WITH (m = 16, ef_construction = 64);
