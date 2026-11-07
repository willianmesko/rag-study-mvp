-- The API is the only reader and writer. Progress belongs to one membership.
CREATE TABLE IF NOT EXISTS workspace_onboarding (
  tenant_id UUID NOT NULL,
  user_id UUID NOT NULL,
  goal TEXT CHECK (goal IN ('legal', 'it', 'custom')),
  furthest_step SMALLINT NOT NULL CHECK (furthest_step BETWEEN 0 AND 2),
  completed BOOLEAN NOT NULL,
  PRIMARY KEY (tenant_id, user_id),
  FOREIGN KEY (tenant_id, user_id) REFERENCES tenant_memberships (tenant_id, user_id) ON DELETE CASCADE,
  CHECK (goal IS NOT NULL OR furthest_step = 0),
  CHECK (NOT completed OR furthest_step = 2)
);

ALTER TABLE workspace_onboarding ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON workspace_onboarding FROM PUBLIC;
DO $$
DECLARE
  api_role TEXT;
BEGIN
  FOR api_role IN SELECT rolname FROM pg_roles WHERE rolname IN ('anon', 'authenticated', 'service_role') LOOP
    EXECUTE format('REVOKE ALL ON workspace_onboarding FROM %I', api_role);
  END LOOP;
END
$$;
