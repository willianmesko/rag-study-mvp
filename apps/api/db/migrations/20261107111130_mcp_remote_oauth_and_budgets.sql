-- MCP business data stays read-only. These private tables hold authorization,
-- reservations, cancellation and rate-limit state; raw queries are never stored.
CREATE TABLE mcp_oauth_clients (
  id TEXT PRIMARY KEY CHECK (id ~ '^lumora_client_[A-Za-z0-9_-]{43}$'),
  name TEXT NOT NULL CHECK (length(name) BETWEEN 1 AND 80),
  redirect_uris JSONB NOT NULL CHECK (jsonb_typeof(redirect_uris)='array' AND jsonb_array_length(redirect_uris) BETWEEN 1 AND 5),
  created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  expires_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp()+interval '30 days'
);
CREATE INDEX mcp_oauth_clients_expiry ON mcp_oauth_clients(expires_at);

CREATE TABLE mcp_oauth_grants (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL,
  user_id UUID NOT NULL,
  client_id TEXT NOT NULL REFERENCES mcp_oauth_clients(id) ON DELETE CASCADE,
  resource TEXT NOT NULL CHECK (length(resource) BETWEEN 1 AND 2048),
  allowed_tools TEXT[] NOT NULL CHECK (cardinality(allowed_tools) BETWEEN 1 AND 5 AND allowed_tools <@ ARRAY['list_sources','get_document','search_workspace','get_ingestion_status','get_quality_report']),
  created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  expires_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp()+interval '30 days',
  revoked_at TIMESTAMPTZ,
  refresh_window TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  refresh_calls INTEGER NOT NULL DEFAULT 0 CHECK (refresh_calls BETWEEN 0 AND 288),
  FOREIGN KEY(tenant_id,user_id) REFERENCES tenant_memberships(tenant_id,user_id) ON DELETE CASCADE
);
CREATE INDEX mcp_oauth_grants_user ON mcp_oauth_grants(tenant_id,user_id,created_at DESC);
CREATE INDEX mcp_oauth_grants_client ON mcp_oauth_grants(client_id);

CREATE TABLE mcp_oauth_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id TEXT NOT NULL REFERENCES mcp_oauth_clients(id) ON DELETE CASCADE,
  redirect_uri TEXT NOT NULL CHECK (length(redirect_uri) BETWEEN 1 AND 2048),
  state TEXT CHECK (length(state)<=1024),
  challenge TEXT NOT NULL CHECK (challenge ~ '^[A-Za-z0-9_-]{43}$'),
  resource TEXT NOT NULL CHECK (length(resource) BETWEEN 1 AND 2048),
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','denied','consumed')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  expires_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp()+interval '10 minutes',
  tenant_id UUID,
  user_id UUID,
  allowed_tools TEXT[],
  code_digest BYTEA UNIQUE CHECK (octet_length(code_digest)=32),
  code_expires_at TIMESTAMPTZ,
  grant_id UUID REFERENCES mcp_oauth_grants(id) ON DELETE SET NULL,
  FOREIGN KEY(tenant_id,user_id) REFERENCES tenant_memberships(tenant_id,user_id) ON DELETE CASCADE,
  CHECK ((tenant_id IS NULL)=(user_id IS NULL)),
  CHECK (status NOT IN ('approved','consumed') OR (tenant_id IS NOT NULL AND allowed_tools IS NOT NULL AND cardinality(allowed_tools) BETWEEN 1 AND 5
    AND allowed_tools <@ ARRAY['list_sources','get_document','search_workspace','get_ingestion_status','get_quality_report'] AND code_digest IS NOT NULL AND code_expires_at IS NOT NULL))
);
CREATE INDEX mcp_oauth_requests_client ON mcp_oauth_requests(client_id,expires_at);
CREATE INDEX mcp_oauth_requests_expiry ON mcp_oauth_requests(expires_at);
CREATE INDEX mcp_oauth_requests_member ON mcp_oauth_requests(tenant_id,user_id) WHERE tenant_id IS NOT NULL;
CREATE INDEX mcp_oauth_requests_grant ON mcp_oauth_requests(grant_id) WHERE grant_id IS NOT NULL;

CREATE TABLE mcp_oauth_tokens (
  digest BYTEA PRIMARY KEY CHECK (octet_length(digest)=32),
  grant_id UUID NOT NULL REFERENCES mcp_oauth_grants(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('access','refresh')),
  expires_at TIMESTAMPTZ NOT NULL,
  used_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX mcp_oauth_tokens_grant ON mcp_oauth_tokens(grant_id);

CREATE TABLE workspace_mcp_call_usage (
  tenant_id UUID NOT NULL,
  user_id UUID NOT NULL,
  usage_day DATE NOT NULL,
  calls INTEGER NOT NULL CHECK (calls BETWEEN 0 AND 10001),
  window_started_at TIMESTAMPTZ NOT NULL,
  window_calls INTEGER NOT NULL CHECK (window_calls BETWEEN 0 AND 1001),
  PRIMARY KEY(tenant_id,user_id,usage_day),
  FOREIGN KEY(tenant_id,user_id) REFERENCES tenant_memberships(tenant_id,user_id) ON DELETE CASCADE
);

CREATE TABLE workspace_mcp_provider_usage (
  tenant_id UUID NOT NULL,
  user_id UUID NOT NULL,
  usage_day DATE NOT NULL,
  calls INTEGER NOT NULL DEFAULT 0 CHECK (calls BETWEEN 0 AND 10000),
  input_tokens BIGINT NOT NULL DEFAULT 0 CHECK (input_tokens>=0),
  cost_nano_usd BIGINT NOT NULL DEFAULT 0 CHECK (cost_nano_usd>=0),
  PRIMARY KEY(tenant_id,user_id,usage_day),
  FOREIGN KEY(tenant_id,user_id) REFERENCES tenant_memberships(tenant_id,user_id) ON DELETE CASCADE
);
CREATE INDEX workspace_mcp_provider_usage_day ON workspace_mcp_provider_usage(tenant_id,usage_day);

CREATE TABLE workspace_mcp_provider_reservations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL,
  user_id UUID NOT NULL,
  input_tokens INTEGER NOT NULL CHECK (input_tokens BETWEEN 1 AND 2048),
  cost_nano_usd BIGINT NOT NULL CHECK (cost_nano_usd>=0),
  expires_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp()+interval '15 seconds',
  finished_at TIMESTAMPTZ,
  FOREIGN KEY(tenant_id,user_id) REFERENCES tenant_memberships(tenant_id,user_id) ON DELETE CASCADE
);
CREATE INDEX workspace_mcp_provider_active ON workspace_mcp_provider_reservations(tenant_id,expires_at) WHERE finished_at IS NULL;
CREATE INDEX workspace_mcp_provider_member ON workspace_mcp_provider_reservations(tenant_id,user_id);

CREATE TABLE workspace_mcp_executions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  grant_id UUID NOT NULL REFERENCES mcp_oauth_grants(id) ON DELETE CASCADE,
  request_key TEXT NOT NULL CHECK (request_key ~ '^[0-9a-f]{64}$'),
  tool TEXT NOT NULL CHECK (tool IN ('list_sources','get_document','search_workspace','get_ingestion_status','get_quality_report')),
  state TEXT NOT NULL DEFAULT 'running' CHECK (state IN ('running','cancel_requested','finished')),
  expires_at TIMESTAMPTZ NOT NULL,
  UNIQUE(grant_id,request_key)
);
CREATE INDEX workspace_mcp_executions_expiry ON workspace_mcp_executions(expires_at);

DO $$
DECLARE table_name TEXT; api_role TEXT;
BEGIN
  FOREACH table_name IN ARRAY ARRAY['mcp_oauth_clients','mcp_oauth_grants','mcp_oauth_requests','mcp_oauth_tokens',
    'workspace_mcp_call_usage','workspace_mcp_provider_usage','workspace_mcp_provider_reservations','workspace_mcp_executions'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY',table_name);
    EXECUTE format('REVOKE ALL ON %I FROM PUBLIC',table_name);
    FOR api_role IN SELECT rolname FROM pg_roles WHERE rolname IN ('anon','authenticated','service_role') LOOP
      EXECUTE format('REVOKE ALL ON %I FROM %I',table_name,api_role);
    END LOOP;
  END LOOP;
END
$$;
