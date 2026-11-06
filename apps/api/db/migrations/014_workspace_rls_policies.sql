-- Browser-facing workspace reads are restricted to authenticated users who have
-- a membership. The API still performs the authoritative role checks server-side.
DROP POLICY IF EXISTS tenants_select_member ON tenants;
CREATE POLICY tenants_select_member ON tenants
  FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM tenant_memberships m
    WHERE m.tenant_id = tenants.id AND m.user_id = (SELECT auth.uid())
  ));

DROP POLICY IF EXISTS tenant_memberships_select_self ON tenant_memberships;
CREATE POLICY tenant_memberships_select_self ON tenant_memberships
  FOR SELECT TO authenticated
  USING (user_id = (SELECT auth.uid()));

DROP POLICY IF EXISTS documents_select_member ON documents;
CREATE POLICY documents_select_member ON documents
  FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM tenant_memberships m
    WHERE m.tenant_id = documents.tenant_id AND m.user_id = (SELECT auth.uid())
  ));

DROP POLICY IF EXISTS chunks_select_member ON chunks;
CREATE POLICY chunks_select_member ON chunks
  FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1
    FROM documents d
    JOIN tenant_memberships m ON m.tenant_id = d.tenant_id
    WHERE d.id = chunks.document_id AND m.user_id = (SELECT auth.uid())
  ));

DROP POLICY IF EXISTS ingestion_jobs_select_member ON ingestion_jobs;
CREATE POLICY ingestion_jobs_select_member ON ingestion_jobs
  FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM tenant_memberships m
    WHERE m.tenant_id = ingestion_jobs.tenant_id AND m.user_id = (SELECT auth.uid())
  ));

DROP POLICY IF EXISTS ingestion_job_events_select_member ON ingestion_job_events;
CREATE POLICY ingestion_job_events_select_member ON ingestion_job_events
  FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM tenant_memberships m
    WHERE m.tenant_id = ingestion_job_events.tenant_id AND m.user_id = (SELECT auth.uid())
  ));

-- Audit, quota, cache, and provider-usage tables remain backend-only. They have
-- RLS enabled but intentionally no publishable-key policies.
