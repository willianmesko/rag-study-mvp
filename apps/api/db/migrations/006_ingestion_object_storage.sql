-- The original upload can be held in a private object store instead of the
-- database job payload. The object itself lives in the private `rag-originals`
-- Supabase Storage bucket; this column holds only its opaque server-side key.
ALTER TABLE ingestion_jobs
  ADD COLUMN IF NOT EXISTS storage_path TEXT;

ALTER TABLE ingestion_jobs
  ADD CONSTRAINT ingestion_jobs_payload_or_storage_path_check
  CHECK (status = 'completed' OR payload IS NOT NULL OR storage_path IS NOT NULL)
  NOT VALID;
