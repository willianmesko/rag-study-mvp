-- Application authorization is derived from a server-validated Supabase user
-- and a tenant membership, never from editable browser metadata or tenant IDs.
CREATE TABLE IF NOT EXISTS tenant_memberships (
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  user_id UUID NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('owner', 'editor', 'viewer')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (tenant_id, user_id)
);

CREATE INDEX IF NOT EXISTS tenant_memberships_user_id_idx
  ON tenant_memberships (user_id, created_at);

ALTER TABLE tenant_memberships ENABLE ROW LEVEL SECURITY;
