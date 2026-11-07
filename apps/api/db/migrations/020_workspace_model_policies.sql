CREATE TABLE IF NOT EXISTS workspace_chat_model_policies (
  tenant_id UUID PRIMARY KEY REFERENCES tenants(id) ON DELETE CASCADE,
  policy JSONB NOT NULL CHECK (jsonb_typeof(policy) = 'object' AND pg_column_size(policy) <= 4096),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE workspace_chat_model_policies ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON workspace_chat_model_policies FROM PUBLIC;
DO $$
DECLARE
  api_role TEXT;
BEGIN
  FOR api_role IN SELECT rolname FROM pg_roles WHERE rolname IN ('anon', 'authenticated', 'service_role') LOOP
    EXECUTE format('REVOKE ALL ON workspace_chat_model_policies FROM %I', api_role);
  END LOOP;
END
$$;
