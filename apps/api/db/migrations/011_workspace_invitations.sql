CREATE TABLE IF NOT EXISTS workspace_invitations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  email TEXT NOT NULL CHECK (email = lower(email)),
  role TEXT NOT NULL CHECK (role IN ('editor', 'viewer')),
  invited_by UUID NOT NULL,
  invited_user_id UUID,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'accepted', 'revoked', 'expired')),
  invited_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  accepted_at TIMESTAMPTZ,
  expires_at TIMESTAMPTZ NOT NULL DEFAULT (NOW() + INTERVAL '7 days'),
  UNIQUE (tenant_id, email)
);
ALTER TABLE workspace_invitations ENABLE ROW LEVEL SECURITY;
CREATE INDEX IF NOT EXISTS workspace_invitations_tenant_status_idx ON workspace_invitations (tenant_id, status, invited_at DESC);
