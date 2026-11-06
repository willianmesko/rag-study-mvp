-- Evaluation history is private backend data. The API exposes only
-- tenant-scoped, sanitized metrics and case identifiers to workspace owners.
CREATE TABLE IF NOT EXISTS evaluation_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  dataset_name TEXT NOT NULL,
  dataset_version TEXT NOT NULL,
  commit_sha TEXT,
  embedding_provider TEXT NOT NULL,
  embedding_model TEXT NOT NULL,
  chat_provider TEXT NOT NULL,
  chat_model TEXT NOT NULL,
  total_cases INTEGER NOT NULL CHECK (total_cases >= 0),
  hit_rate NUMERIC(8, 6) NOT NULL CHECK (hit_rate >= 0 AND hit_rate <= 1),
  mean_reciprocal_rank NUMERIC(8, 6) NOT NULL CHECK (mean_reciprocal_rank >= 0 AND mean_reciprocal_rank <= 1),
  faithfulness NUMERIC(8, 6) CHECK (faithfulness IS NULL OR (faithfulness >= 0 AND faithfulness <= 1)),
  context_precision NUMERIC(8, 6) CHECK (context_precision IS NULL OR (context_precision >= 0 AND context_precision <= 1)),
  injection_pass_rate NUMERIC(8, 6) NOT NULL CHECK (injection_pass_rate >= 0 AND injection_pass_rate <= 1),
  passed BOOLEAN NOT NULL DEFAULT FALSE,
  duration_ms INTEGER NOT NULL CHECK (duration_ms >= 0),
  failure_details JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS evaluation_runs_tenant_created_at_idx
  ON evaluation_runs (tenant_id, created_at DESC);

ALTER TABLE evaluation_runs ENABLE ROW LEVEL SECURITY;
