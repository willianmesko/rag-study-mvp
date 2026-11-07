-- Short-lived chat replay is accessible only through the authenticated API.
-- Raw questions are not stored. Runs and events disappear if membership ends.
CREATE TABLE IF NOT EXISTS chat_runs (
  tenant_id UUID NOT NULL,
  actor_id UUID NOT NULL,
  run_id UUID NOT NULL,
  status TEXT NOT NULL DEFAULT 'running' CHECK (status IN ('running', 'completed', 'failed', 'cancelled')),
  last_event_id INTEGER NOT NULL DEFAULT 1 CHECK (last_event_id BETWEEN 1 AND 512),
  deadline_at TIMESTAMPTZ NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL DEFAULT NOW() + INTERVAL '24 hours',
  PRIMARY KEY (tenant_id, actor_id, run_id),
  FOREIGN KEY (tenant_id, actor_id) REFERENCES tenant_memberships (tenant_id, user_id) ON DELETE CASCADE,
  CHECK (deadline_at < expires_at)
);

CREATE INDEX IF NOT EXISTS chat_runs_expiry_idx ON chat_runs (expires_at);

CREATE TABLE IF NOT EXISTS chat_run_events (
  tenant_id UUID NOT NULL,
  actor_id UUID NOT NULL,
  run_id UUID NOT NULL,
  event_id INTEGER NOT NULL CHECK (event_id BETWEEN 1 AND 512),
  event JSONB NOT NULL CHECK (jsonb_typeof(event) = 'object' AND pg_column_size(event) <= 1048576),
  PRIMARY KEY (tenant_id, actor_id, run_id, event_id),
  FOREIGN KEY (tenant_id, actor_id, run_id) REFERENCES chat_runs (tenant_id, actor_id, run_id) ON DELETE CASCADE
);

ALTER TABLE chat_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE chat_run_events ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON chat_runs, chat_run_events FROM PUBLIC;
DO $$
DECLARE
  api_role TEXT;
BEGIN
  FOR api_role IN SELECT rolname FROM pg_roles WHERE rolname IN ('anon', 'authenticated', 'service_role') LOOP
    EXECUTE format('REVOKE ALL ON chat_runs, chat_run_events FROM %I', api_role);
  END LOOP;
END
$$;
