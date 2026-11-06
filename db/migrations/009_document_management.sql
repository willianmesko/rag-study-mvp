-- Link an uploaded original to its resulting document. This makes a real
-- reindex possible without accepting a new browser upload each time.
ALTER TABLE ingestion_jobs
  ADD COLUMN IF NOT EXISTS document_id UUID REFERENCES documents(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS ingestion_jobs_tenant_document_updated_at_idx
  ON ingestion_jobs (tenant_id, document_id, updated_at DESC);
