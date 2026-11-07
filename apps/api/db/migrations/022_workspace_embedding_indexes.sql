-- Backfill is an explicit operator command. Existing live vectors remain readable.
CREATE TABLE IF NOT EXISTS workspace_embedding_versions (
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  id UUID NOT NULL DEFAULT gen_random_uuid(),
  revision UUID NOT NULL DEFAULT gen_random_uuid(),
  provider TEXT NOT NULL CHECK (provider IN ('ollama', 'openrouter', 'bedrock')),
  model TEXT NOT NULL CHECK (length(model) BETWEEN 1 AND 200),
  dimensions SMALLINT NOT NULL CHECK (dimensions = 1024),
  state TEXT NOT NULL CHECK (state IN ('active', 'building', 'previous')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (tenant_id, id),
  CONSTRAINT workspace_embedding_state_unique UNIQUE (tenant_id, state) DEFERRABLE INITIALLY IMMEDIATE
);

CREATE TABLE IF NOT EXISTS workspace_embedding_staged_vectors (
  tenant_id UUID NOT NULL,
  version_id UUID NOT NULL,
  chunk_id UUID NOT NULL REFERENCES chunks(id) ON DELETE CASCADE,
  embedding VECTOR(1024) NOT NULL,
  PRIMARY KEY (tenant_id, version_id, chunk_id),
  FOREIGN KEY (tenant_id, version_id) REFERENCES workspace_embedding_versions(tenant_id, id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS workspace_embedding_staged_chunk_idx
  ON workspace_embedding_staged_vectors (chunk_id);

ALTER TABLE workspace_embedding_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE workspace_embedding_staged_vectors ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON workspace_embedding_versions, workspace_embedding_staged_vectors FROM PUBLIC;
DO $$
DECLARE
  api_role TEXT;
BEGIN
  FOR api_role IN SELECT rolname FROM pg_roles WHERE rolname IN ('anon', 'authenticated', 'service_role') LOOP
    EXECUTE format('REVOKE ALL ON workspace_embedding_versions, workspace_embedding_staged_vectors FROM %I', api_role);
  END LOOP;
END
$$;
