CREATE TABLE IF NOT EXISTS ingestion_job_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id UUID NOT NULL REFERENCES ingestion_jobs(id) ON DELETE CASCADE,
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  stage TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('started', 'completed', 'failed', 'info')),
  duration_ms INTEGER CHECK (duration_ms IS NULL OR duration_ms >= 0),
  details JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS ingestion_job_events_job_created_at_idx
  ON ingestion_job_events (job_id, created_at ASC);

CREATE INDEX IF NOT EXISTS ingestion_job_events_tenant_created_at_idx
  ON ingestion_job_events (tenant_id, created_at DESC);

ALTER TABLE ingestion_job_events ENABLE ROW LEVEL SECURITY;
