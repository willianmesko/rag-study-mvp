-- pgvector supplies the vector type and cosine-distance operator (<=>).
CREATE EXTENSION IF NOT EXISTS vector;

CREATE TABLE IF NOT EXISTS schema_migrations (
  version TEXT PRIMARY KEY,
  applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS documents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  source TEXT NOT NULL UNIQUE,
  title TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS chunks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  document_id UUID NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  ordinal INTEGER NOT NULL CHECK (ordinal >= 0),
  content TEXT NOT NULL CHECK (length(content) > 0),
  -- All selected embedding providers must return 1,024 dimensions for this MVP schema.
  embedding vector(1024) NOT NULL,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(document_id, ordinal)
);

-- HNSW has good recall/latency for an online retrieval workload. With a tiny study
-- corpus a sequential scan is normally faster; keep this index to make the production
-- path visible. Tune hnsw.ef_search only after measuring recall and latency.
CREATE INDEX IF NOT EXISTS chunks_embedding_hnsw_cosine_idx
  ON chunks USING hnsw (embedding vector_cosine_ops);

CREATE INDEX IF NOT EXISTS chunks_document_id_idx ON chunks(document_id);

