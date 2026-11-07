-- Additive rollout: old workers continue writing legacy ciphertext until opted in.
ALTER TABLE workflow_runs ADD COLUMN correlation_id VARCHAR(64);
ALTER TABLE workflow_runs DROP CONSTRAINT workflow_runs_input_cipher_check;
ALTER TABLE workflow_runs ADD CONSTRAINT workflow_runs_input_cipher_check CHECK(octet_length(input_cipher)<=16777316);
ALTER TABLE workflow_checkpoints DROP CONSTRAINT workflow_checkpoints_cipher_check;
ALTER TABLE workflow_checkpoints ADD CONSTRAINT workflow_checkpoints_cipher_check CHECK(octet_length(cipher)<=16777316);
ALTER TABLE workflow_writes DROP CONSTRAINT workflow_writes_cipher_check;
ALTER TABLE workflow_writes ADD CONSTRAINT workflow_writes_cipher_check CHECK(octet_length(cipher)<=16777316);
ALTER TABLE workflow_effects DROP CONSTRAINT workflow_effects_cipher_check;
ALTER TABLE workflow_effects ADD CONSTRAINT workflow_effects_cipher_check CHECK(octet_length(cipher)<=16777316);
-- No historical tokens or costs are manufactured. Existing rows stay schema v1.
ALTER TABLE ai_usage_events ADD COLUMN pricing_known BOOLEAN;
ALTER TABLE ai_usage_events ADD COLUMN measurement_version SMALLINT NOT NULL DEFAULT 1 CHECK(measurement_version IN (1,2));

CREATE TABLE budget_alert_outbox(
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(),tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
 window_date DATE NOT NULL,threshold_micros BIGINT NOT NULL CHECK(threshold_micros>0),
 cost_usd NUMERIC(18,8) NOT NULL CHECK(cost_usd>=0),unpriced_requests INTEGER NOT NULL DEFAULT 0 CHECK(unpriced_requests>=0),
 status TEXT NOT NULL DEFAULT 'queued' CHECK(status IN ('queued','sending','delivered','dead_letter')),
 attempts INTEGER NOT NULL DEFAULT 0 CHECK(attempts BETWEEN 0 AND 8),
 available_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),lease_until TIMESTAMPTZ,lease_token UUID,
 last_code VARCHAR(80),created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),delivered_at TIMESTAMPTZ,
 UNIQUE(tenant_id,window_date,threshold_micros)
);
CREATE INDEX budget_alert_ready ON budget_alert_outbox(status,available_at,lease_until) WHERE status IN ('queued','sending');
CREATE INDEX budget_alert_workspace ON budget_alert_outbox(tenant_id,created_at DESC);
ALTER TABLE budget_alert_outbox ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON budget_alert_outbox FROM PUBLIC;
DO $$ DECLARE r TEXT; BEGIN
 FOR r IN SELECT rolname FROM pg_roles WHERE rolname IN ('anon','authenticated','service_role') LOOP
  EXECUTE format('REVOKE ALL ON budget_alert_outbox FROM %I',r);
 END LOOP;
END $$;
