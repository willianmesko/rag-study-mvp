// Diagnostic receipts contain fixed internal categories and counts, never the
// job error message, provider body, encrypted state, source text or credentials.
const stages = new Set(["source_read", "text_extraction", "quality_gate", "text_quality", "ocr_fallback",
  "metadata", "language", "structure", "chunking", "security_scan", "embedding", "persistence", "complete_ingestion"]);
const reasons = new Set(["effect_outcome_unknown", "budget_exceeded", "lease_lost", "cancelled", "deadline_exceeded",
  "authorization_revoked", "definition_changed", "state_limit", "queue_full", "execution_failed", "rate_limited"]);
const statuses = new Set(["queued", "processing", "running", "waiting_approval", "completed", "failed", "cancelled"]);
export function safeFailureRows(rows) {
  return rows.map((row) => ({ status: statuses.has(row.status) ? row.status : "other",
    ...(Object.hasOwn(row, "stage") ? { stage: stages.has(row.stage) ? row.stage : "other" } : {}),
    ...(Object.hasOwn(row, "error_code") ? { reason: row.error_code === null ? null : reasons.has(row.error_code) ? row.error_code : "other" } : {}),
    count: Number.isSafeInteger(row.count) && row.count >= 0 ? row.count : null }));
}
export async function captureFailureState(pool, tenantIds) {
  const jobs = await pool.query("SELECT status,count(*)::int AS count FROM ingestion_jobs WHERE tenant_id=ANY($1::uuid[]) GROUP BY status", [tenantIds]);
  const workflows = await pool.query(`SELECT status,stage,error_code,count(*)::int AS count FROM workflow_runs
    WHERE tenant_id=ANY($1::uuid[]) AND kind='ingestion' GROUP BY status,stage,error_code`, [tenantIds]);
  return { ingestionJobs: safeFailureRows(jobs.rows), ingestionWorkflows: safeFailureRows(workflows.rows) };
}
