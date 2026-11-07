// The ingestion worker records the job ID with the indexed revision. Replacing
// the document also replaces its metadata, so historical uploads do not match.
// This rule is independent of job status because reindexing reuses the same job.
export const indexedOriginalPredicate = `
  j.tenant_id = d.tenant_id
  AND j.document_id = d.id
  AND j.source = d.source
  AND j.id::text = (d.metadata ->> 'ingestionJobId')
  AND (j.payload IS NOT NULL OR j.storage_path IS NOT NULL)
`;
