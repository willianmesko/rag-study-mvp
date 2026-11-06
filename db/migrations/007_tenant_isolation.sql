-- Stage one of multi-tenancy: every persisted document and ingestion job is
-- owned by a tenant, and every retrieval query must receive that tenant id.
CREATE TABLE IF NOT EXISTS tenants (
  id UUID PRIMARY KEY,
  slug TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO tenants (id, slug, name)
VALUES ('00000000-0000-4000-8000-000000000001', 'demo', 'Demo workspace')
ON CONFLICT (id) DO NOTHING;

ALTER TABLE documents ADD COLUMN IF NOT EXISTS tenant_id UUID;
UPDATE documents SET tenant_id = '00000000-0000-4000-8000-000000000001' WHERE tenant_id IS NULL;
ALTER TABLE documents ALTER COLUMN tenant_id SET NOT NULL;
ALTER TABLE documents ADD CONSTRAINT documents_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES tenants(id);
ALTER TABLE documents DROP CONSTRAINT IF EXISTS documents_source_key;
CREATE UNIQUE INDEX IF NOT EXISTS documents_tenant_source_key ON documents (tenant_id, source);
CREATE INDEX IF NOT EXISTS documents_tenant_id_idx ON documents (tenant_id);

ALTER TABLE ingestion_jobs ADD COLUMN IF NOT EXISTS tenant_id UUID;
UPDATE ingestion_jobs SET tenant_id = '00000000-0000-4000-8000-000000000001' WHERE tenant_id IS NULL;
ALTER TABLE ingestion_jobs ALTER COLUMN tenant_id SET NOT NULL;
ALTER TABLE ingestion_jobs ADD CONSTRAINT ingestion_jobs_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES tenants(id);
CREATE INDEX IF NOT EXISTS ingestion_jobs_tenant_created_at_idx ON ingestion_jobs (tenant_id, created_at DESC);

ALTER TABLE tenants ENABLE ROW LEVEL SECURITY;
