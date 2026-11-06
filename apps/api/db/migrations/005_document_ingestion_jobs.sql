CREATE TABLE IF NOT EXISTS ingestion_jobs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  source TEXT NOT NULL,
  title TEXT,
  filename TEXT NOT NULL,
  mime_type TEXT NOT NULL,
  payload BYTEA,
  status TEXT NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'processing', 'completed', 'failed')),
  progress SMALLINT NOT NULL DEFAULT 0 CHECK (progress BETWEEN 0 AND 100),
  error TEXT,
  chunk_count INTEGER,
  high_risk_chunks INTEGER,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS ingestion_jobs_status_created_at_idx ON ingestion_jobs (status, created_at);
ALTER TABLE ingestion_jobs ENABLE ROW LEVEL SECURITY;
