-- No historical delivery outcomes are invented. Legacy incomplete effects remain uncertain.
ALTER TABLE ingestion_jobs ADD COLUMN idempotency_key_hash TEXT CHECK(idempotency_key_hash IS NULL OR idempotency_key_hash ~ '^[a-f0-9]{64}$');
ALTER TABLE ingestion_jobs ADD COLUMN request_hash TEXT CHECK(request_hash IS NULL OR request_hash ~ '^[a-f0-9]{64}$');
ALTER TABLE ingestion_jobs ADD COLUMN admission_attempts INTEGER NOT NULL DEFAULT 0 CHECK(admission_attempts BETWEEN 0 AND 8);
ALTER TABLE ingestion_jobs ADD COLUMN available_at TIMESTAMPTZ NOT NULL DEFAULT NOW();
CREATE UNIQUE INDEX ingestion_jobs_idempotency ON ingestion_jobs(tenant_id,idempotency_key_hash) WHERE idempotency_key_hash IS NOT NULL;
CREATE INDEX ingestion_jobs_available ON ingestion_jobs(available_at,created_at) WHERE status='queued';
ALTER TABLE workflow_runs ADD COLUMN available_at TIMESTAMPTZ NOT NULL DEFAULT NOW();
ALTER TABLE workflow_effects ADD COLUMN state TEXT CHECK(state IN ('started','completed','retryable','permanent','ambiguous'));
ALTER TABLE workflow_effects ADD COLUMN last_code TEXT CHECK(length(last_code)<=80);
ALTER TABLE workflow_effects ADD COLUMN updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();
CREATE TABLE integration_delivery_events (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  delivery_id UUID NOT NULL REFERENCES budget_alert_outbox(id) ON DELETE CASCADE,
  outcome TEXT NOT NULL CHECK(outcome IN ('queued','sending','delivered','dead_letter','replayed','retry')),
  reason TEXT NOT NULL CHECK(reason ~ '^[a-z0-9_]{1,80}$'),
  attempt INTEGER NOT NULL CHECK(attempt BETWEEN 0 AND 8),
  actor_user_id UUID,
  command_key TEXT CHECK(command_key IS NULL OR command_key ~ '^[a-f0-9]{64}$'),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX integration_delivery_events_scope ON integration_delivery_events(tenant_id,delivery_id,id);
CREATE UNIQUE INDEX integration_delivery_commands ON integration_delivery_events(tenant_id,delivery_id,command_key) WHERE command_key IS NOT NULL;
ALTER TABLE integration_delivery_events ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON integration_delivery_events FROM PUBLIC;
REVOKE ALL ON SEQUENCE integration_delivery_events_id_seq FROM PUBLIC;
DO $private_roles$
DECLARE api_role TEXT;
BEGIN
  FOR api_role IN SELECT rolname FROM pg_roles WHERE rolname IN ('anon','authenticated','service_role') LOOP
    EXECUTE format('REVOKE ALL ON integration_delivery_events FROM %I',api_role);
    EXECUTE format('REVOKE ALL ON SEQUENCE integration_delivery_events_id_seq FROM %I',api_role);
  END LOOP;
END
$private_roles$;
