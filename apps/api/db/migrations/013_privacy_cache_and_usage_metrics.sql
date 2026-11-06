CREATE TABLE IF NOT EXISTS semantic_answer_cache (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  question_hash CHAR(64) NOT NULL,
  embedding vector(1024) NOT NULL,
  answer TEXT NOT NULL,
  sources JSONB NOT NULL DEFAULT '[]'::jsonb,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (tenant_id, question_hash)
);

CREATE INDEX IF NOT EXISTS semantic_answer_cache_tenant_expiry_idx
  ON semantic_answer_cache (tenant_id, expires_at);

CREATE TABLE IF NOT EXISTS ai_usage_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  actor_key TEXT NOT NULL,
  operation TEXT NOT NULL,
  provider TEXT NOT NULL,
  model TEXT NOT NULL,
  cache_hit BOOLEAN NOT NULL DEFAULT FALSE,
  input_tokens INTEGER NOT NULL DEFAULT 0 CHECK (input_tokens >= 0),
  output_tokens INTEGER NOT NULL DEFAULT 0 CHECK (output_tokens >= 0),
  latency_ms INTEGER NOT NULL CHECK (latency_ms >= 0),
  estimated_cost_usd NUMERIC(14, 8) NOT NULL DEFAULT 0 CHECK (estimated_cost_usd >= 0),
  failed BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS ai_usage_events_tenant_created_at_idx
  ON ai_usage_events (tenant_id, created_at DESC);

ALTER TABLE semantic_answer_cache ENABLE ROW LEVEL SECURITY;
ALTER TABLE ai_usage_events ENABLE ROW LEVEL SECURITY;
