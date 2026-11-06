-- Cost guardrails: atomic daily counters keep an individual tenant or admin
-- from accidentally turning a public demo into an unbounded provider bill.
CREATE TABLE IF NOT EXISTS tenant_daily_usage (
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  actor_key TEXT NOT NULL,
  usage_date DATE NOT NULL DEFAULT CURRENT_DATE,
  qa_requests INTEGER NOT NULL DEFAULT 0 CHECK (qa_requests >= 0),
  uploaded_bytes BIGINT NOT NULL DEFAULT 0 CHECK (uploaded_bytes >= 0),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (tenant_id, actor_key, usage_date)
);

CREATE TABLE IF NOT EXISTS audit_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  actor_user_id UUID,
  action TEXT NOT NULL,
  resource_type TEXT NOT NULL,
  resource_id UUID,
  request_id TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS audit_events_tenant_created_at_idx
  ON audit_events (tenant_id, created_at DESC);

ALTER TABLE tenant_daily_usage ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_events ENABLE ROW LEVEL SECURITY;
