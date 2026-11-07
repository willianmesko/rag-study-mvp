-- Private application records: the API checks membership; Data API roles have no grants.
CREATE TABLE workflow_runs (
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  actor_id TEXT NOT NULL CHECK (length(actor_id) BETWEEN 1 AND 100),
  run_id UUID NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('chat','ingestion','evaluation')),
  actor_user_id UUID GENERATED ALWAYS AS (CASE WHEN kind='ingestion' THEN NULL::uuid ELSE actor_id::uuid END) STORED,
  version TEXT NOT NULL CHECK (length(version) BETWEEN 1 AND 80),
  input_hash TEXT NOT NULL,
  input_cipher BYTEA NOT NULL CHECK (octet_length(input_cipher) <= 16777244),
  budget JSONB NOT NULL,
  status TEXT NOT NULL DEFAULT 'queued' CHECK (status IN ('queued','running','waiting_approval','completed','failed','cancelled')),
  stage TEXT,
  steps INTEGER NOT NULL DEFAULT 0 CHECK (steps >= 0),
  calls INTEGER NOT NULL DEFAULT 0 CHECK (calls >= 0),
  input_tokens INTEGER NOT NULL DEFAULT 0 CHECK (input_tokens >= 0),
  output_tokens INTEGER NOT NULL DEFAULT 0 CHECK (output_tokens >= 0),
  cost_micros INTEGER NOT NULL DEFAULT 0 CHECK (cost_micros >= 0),
  attempts INTEGER NOT NULL DEFAULT 0,
  lease_token UUID,
  lease_until TIMESTAMPTZ,
  approved_by UUID,
  error_code TEXT,
  result_id UUID,
  deadline_at TIMESTAMPTZ NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL DEFAULT (NOW() + INTERVAL '24 hours'),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (tenant_id, actor_id, run_id),
  FOREIGN KEY (tenant_id,actor_user_id) REFERENCES tenant_memberships(tenant_id,user_id) ON DELETE CASCADE
);
CREATE INDEX workflow_runs_ready ON workflow_runs(created_at,tenant_id) WHERE status IN ('queued','running');
CREATE INDEX workflow_runs_workspace ON workflow_runs(tenant_id,kind,created_at DESC);
CREATE INDEX workflow_runs_expiry ON workflow_runs(expires_at);
CREATE INDEX workflow_runs_member ON workflow_runs(tenant_id,actor_user_id) WHERE actor_user_id IS NOT NULL;

CREATE TABLE workflow_checkpoints (
  tenant_id UUID NOT NULL, actor_id TEXT NOT NULL, run_id UUID NOT NULL,
  graph_name TEXT NOT NULL, namespace TEXT NOT NULL, checkpoint_id TEXT NOT NULL,
  parent_id TEXT, encoding TEXT NOT NULL, cipher BYTEA NOT NULL CHECK (octet_length(cipher) <= 16777244),
  PRIMARY KEY (tenant_id,actor_id,run_id,graph_name,namespace,checkpoint_id),
  FOREIGN KEY (tenant_id,actor_id,run_id) REFERENCES workflow_runs ON DELETE CASCADE
);
CREATE TABLE workflow_writes (
  tenant_id UUID NOT NULL, actor_id TEXT NOT NULL, run_id UUID NOT NULL,
  graph_name TEXT NOT NULL, namespace TEXT NOT NULL, checkpoint_id TEXT NOT NULL,
  task_id TEXT NOT NULL, task_path TEXT NOT NULL, ordinal INTEGER NOT NULL,
  encoding TEXT NOT NULL, cipher BYTEA NOT NULL CHECK (octet_length(cipher) <= 16777244),
  PRIMARY KEY (tenant_id,actor_id,run_id,graph_name,namespace,checkpoint_id,task_id,ordinal),
  FOREIGN KEY (tenant_id,actor_id,run_id) REFERENCES workflow_runs ON DELETE CASCADE
);
CREATE TABLE workflow_effects (
  tenant_id UUID NOT NULL, actor_id TEXT NOT NULL, run_id UUID NOT NULL,
  effect_key TEXT NOT NULL, attempts INTEGER NOT NULL DEFAULT 1,
  cipher BYTEA CHECK (octet_length(cipher) <= 16777244),
  PRIMARY KEY (tenant_id,actor_id,run_id,effect_key),
  FOREIGN KEY (tenant_id,actor_id,run_id) REFERENCES workflow_runs ON DELETE CASCADE
);
CREATE TABLE workflow_quota_receipts (
  tenant_id UUID NOT NULL, actor_id TEXT NOT NULL, run_id UUID NOT NULL,
  receipt_key TEXT NOT NULL CHECK (length(receipt_key)<=100),
  PRIMARY KEY(tenant_id,actor_id,run_id,receipt_key),
  FOREIGN KEY(tenant_id,actor_id,run_id) REFERENCES workflow_runs ON DELETE CASCADE
);
CREATE TABLE workflow_events (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  tenant_id UUID NOT NULL, actor_id TEXT NOT NULL, run_id UUID NOT NULL,
  stage TEXT, outcome TEXT NOT NULL, duration_ms INTEGER,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  FOREIGN KEY (tenant_id,actor_id,run_id) REFERENCES workflow_runs ON DELETE CASCADE
);
CREATE INDEX workflow_events_run ON workflow_events(tenant_id,actor_id,run_id,id);

ALTER TABLE workflow_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE workflow_checkpoints ENABLE ROW LEVEL SECURITY;
ALTER TABLE workflow_writes ENABLE ROW LEVEL SECURITY;
ALTER TABLE workflow_effects ENABLE ROW LEVEL SECURITY;
ALTER TABLE workflow_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE workflow_quota_receipts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON workflow_runs,workflow_checkpoints,workflow_writes,workflow_effects,workflow_events,workflow_quota_receipts FROM PUBLIC;
REVOKE ALL ON SEQUENCE workflow_events_id_seq FROM PUBLIC;
DO $private_roles$
DECLARE api_role TEXT;
BEGIN
  FOR api_role IN SELECT rolname FROM pg_roles WHERE rolname IN ('anon','authenticated','service_role') LOOP
    EXECUTE format('REVOKE ALL ON workflow_runs,workflow_checkpoints,workflow_writes,workflow_effects,workflow_events,workflow_quota_receipts FROM %I',api_role);
    EXECUTE format('REVOKE ALL ON SEQUENCE workflow_events_id_seq FROM %I',api_role);
  END LOOP;
END
$private_roles$;

ALTER TABLE evaluation_runs ADD COLUMN workflow_run_id UUID;
CREATE UNIQUE INDEX evaluation_runs_workflow ON evaluation_runs(tenant_id,workflow_run_id) WHERE workflow_run_id IS NOT NULL;

ALTER TABLE chat_run_events ADD COLUMN event_key TEXT;
CREATE UNIQUE INDEX chat_run_events_publication ON chat_run_events(tenant_id,actor_id,run_id,event_key) WHERE event_key IS NOT NULL;

ALTER TABLE ai_usage_events ADD COLUMN workflow_run_id UUID;
ALTER TABLE ai_usage_events ADD COLUMN workflow_record_key TEXT;
CREATE UNIQUE INDEX ai_usage_events_workflow ON ai_usage_events(tenant_id,workflow_run_id,workflow_record_key) WHERE workflow_run_id IS NOT NULL;
