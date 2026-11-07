CREATE TABLE IF NOT EXISTS workspace_mcp_access (
  tenant_id UUID NOT NULL,
  user_id UUID NOT NULL,
  token_digest BYTEA UNIQUE CHECK (octet_length(token_digest) = 32),
  expires_at TIMESTAMPTZ,
  issued_calls INTEGER NOT NULL DEFAULT 0 CHECK (issued_calls BETWEEN 0 AND 41),
  window_started_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  window_calls INTEGER NOT NULL DEFAULT 0 CHECK (window_calls BETWEEN 0 AND 11),
  PRIMARY KEY (tenant_id, user_id),
  FOREIGN KEY (tenant_id, user_id) REFERENCES tenant_memberships (tenant_id, user_id) ON DELETE CASCADE,
  CHECK ((token_digest IS NULL) = (expires_at IS NULL))
);

ALTER TABLE workspace_mcp_access ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON workspace_mcp_access FROM PUBLIC;
DO $$
DECLARE
  api_role TEXT;
BEGIN
  FOR api_role IN SELECT rolname FROM pg_roles WHERE rolname IN ('anon', 'authenticated', 'service_role') LOOP
    EXECUTE format('REVOKE ALL ON workspace_mcp_access FROM %I', api_role);
  END LOOP;
END
$$;
