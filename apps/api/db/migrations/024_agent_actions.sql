-- Private approval, worker lease and transition history for the deterministic
-- lexical evaluation action. The MCP read bridge never gets this capability.
CREATE TABLE agent_actions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  requested_by UUID NOT NULL,
  idempotency_key_hash TEXT NOT NULL CHECK (idempotency_key_hash ~ '^[0-9a-f]{64}$'),
  action TEXT NOT NULL CHECK (action = 'run_evaluation'),
  status TEXT NOT NULL CHECK (status IN ('pending_approval', 'queued', 'running', 'succeeded', 'dead_letter')),
  attempts INTEGER NOT NULL DEFAULT 0 CHECK (attempts BETWEEN 0 AND 3),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMPTZ NOT NULL DEFAULT NOW() + INTERVAL '1 day',
  ready_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  approved_by UUID,
  approved_at TIMESTAMPTZ,
  lease_id UUID,
  lease_until TIMESTAMPTZ,
  evaluation_run_id UUID,
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, requested_by, idempotency_key_hash),
  CHECK ((approved_by IS NULL) = (approved_at IS NULL)),
  CHECK (status IN ('pending_approval', 'dead_letter') OR approved_by IS NOT NULL),
  CHECK ((status = 'running') = (lease_id IS NOT NULL AND lease_until IS NOT NULL)),
  CHECK ((lease_id IS NULL) = (lease_until IS NULL)),
  CHECK ((status = 'succeeded') = (evaluation_run_id IS NOT NULL))
);

CREATE UNIQUE INDEX agent_actions_tenant_active_idx
  ON agent_actions (tenant_id)
  WHERE status IN ('pending_approval', 'queued', 'running');
CREATE INDEX agent_actions_ready_idx
  ON agent_actions (ready_at, id)
  WHERE status = 'queued';
CREATE INDEX agent_actions_lease_idx
  ON agent_actions (lease_until)
  WHERE status = 'running';
CREATE INDEX agent_actions_expiry_idx
  ON agent_actions (expires_at)
  WHERE status IN ('pending_approval', 'queued');
CREATE INDEX agent_actions_approved_idx
  ON agent_actions (tenant_id, approved_at DESC)
  WHERE approved_at IS NOT NULL;

CREATE TABLE agent_action_events (
  sequence BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  tenant_id UUID NOT NULL,
  action_id UUID NOT NULL,
  actor_user_id UUID,
  status TEXT NOT NULL CHECK (status IN ('pending_approval', 'queued', 'running', 'succeeded', 'dead_letter')),
  reason TEXT NOT NULL CHECK (reason IN ('requested', 'approved', 'started', 'completed', 'approval_expired',
    'owner_revoked', 'read_failed', 'execution_timeout', 'worker_shutdown', 'lease_expired')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  FOREIGN KEY (tenant_id, action_id) REFERENCES agent_actions(tenant_id, id) ON DELETE CASCADE
);

CREATE INDEX agent_action_events_replay_idx ON agent_action_events (tenant_id, action_id, sequence);

ALTER TABLE agent_actions ENABLE ROW LEVEL SECURITY;
ALTER TABLE agent_action_events ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON agent_actions, agent_action_events FROM PUBLIC;
REVOKE ALL ON SEQUENCE agent_action_events_sequence_seq FROM PUBLIC;
DO $$
DECLARE
  api_role TEXT;
BEGIN
  FOR api_role IN SELECT rolname FROM pg_roles WHERE rolname IN ('anon', 'authenticated', 'service_role') LOOP
    EXECUTE format('REVOKE ALL ON agent_actions, agent_action_events FROM %I', api_role);
    EXECUTE format('REVOKE ALL ON SEQUENCE agent_action_events_sequence_seq FROM %I', api_role);
  END LOOP;
END
$$;
