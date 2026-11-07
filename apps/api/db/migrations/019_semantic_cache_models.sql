-- Keep the unscoped cache separate so a previous build cannot read an
-- answer from an alternate model during a rollout or rollback.
CREATE TABLE IF NOT EXISTS semantic_model_answer_cache (
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  model_key TEXT NOT NULL,
  question_hash CHAR(64) NOT NULL,
  embedding VECTOR(1024) NOT NULL,
  answer TEXT NOT NULL,
  sources JSONB NOT NULL DEFAULT '[]'::jsonb,
  expires_at TIMESTAMPTZ NOT NULL,
  PRIMARY KEY (tenant_id, model_key, question_hash)
);

CREATE INDEX IF NOT EXISTS semantic_model_answer_cache_expiry_idx
  ON semantic_model_answer_cache (tenant_id, model_key, expires_at);

ALTER TABLE semantic_model_answer_cache ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON semantic_model_answer_cache FROM PUBLIC;
DO $$
DECLARE
  api_role TEXT;
BEGIN
  FOR api_role IN SELECT rolname FROM pg_roles WHERE rolname IN ('anon', 'authenticated', 'service_role') LOOP
    EXECUTE format('REVOKE ALL ON semantic_model_answer_cache FROM %I', api_role);
  END LOOP;
END
$$;
