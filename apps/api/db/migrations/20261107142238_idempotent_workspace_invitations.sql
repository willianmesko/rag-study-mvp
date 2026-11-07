-- Product delivery records may hold an authorized recipient address; operational audits may not.
CREATE TABLE workspace_invitation_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  actor_id UUID NOT NULL,
  key_hash TEXT NOT NULL CHECK(key_hash ~ '^[a-f0-9]{64}$'),
  request_hash TEXT NOT NULL CHECK(request_hash ~ '^[a-f0-9]{64}$'),
  email TEXT NOT NULL CHECK(email=lower(email) AND length(email)<=320),
  role TEXT NOT NULL CHECK(role IN ('viewer','editor')),
  state TEXT NOT NULL CHECK(state IN ('sending','completed','retryable','failed','ambiguous')),
  attempts INTEGER NOT NULL DEFAULT 1 CHECK(attempts BETWEEN 1 AND 3),
  available_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  lease_token UUID,
  lease_until TIMESTAMPTZ,
  result_user_id UUID,
  result_role TEXT CHECK(result_role IN ('owner','editor','viewer')),
  last_code TEXT CHECK(last_code ~ '^[a-z0-9_]{1,80}$'),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(tenant_id,actor_id,key_hash),
  CHECK(state<>'completed' OR (result_user_id IS NOT NULL AND result_role IS NOT NULL))
);
CREATE INDEX workspace_invitation_requests_recipient ON workspace_invitation_requests(tenant_id,email,created_at DESC);
ALTER TABLE workspace_invitation_requests ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON workspace_invitation_requests FROM PUBLIC;
DO $private_roles$
DECLARE api_role TEXT;
BEGIN
  FOR api_role IN SELECT rolname FROM pg_roles WHERE rolname IN ('anon','authenticated','service_role') LOOP
    EXECUTE format('REVOKE ALL ON workspace_invitation_requests FROM %I',api_role);
  END LOOP;
END
$private_roles$;
