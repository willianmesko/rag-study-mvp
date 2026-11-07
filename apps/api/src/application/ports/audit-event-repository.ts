export interface AuditEventRepository {
  record(input: {
    tenantId: string;
    actorUserId: string | null;
    action: "document.upload_queued" | "document.ingested_via_api" | "document.original_read" | "document.reindex_queued" | "document.deleted" | "ingestion.retry_queued" | "ingestion.preview_read" | "workspace.member_invited" | "chat.model_policy_updated";
    resourceType: "document" | "ingestion_job" | "tenant_membership" | "workspace_model_policy";
    resourceId: string | null;
    requestId: string;
    metadata: Record<string, string | number | boolean | null>;
  }): Promise<void>;
}
