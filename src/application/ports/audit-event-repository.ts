export interface AuditEventRepository {
  record(input: {
    tenantId: string;
    actorUserId: string | null;
    action: "document.upload_queued" | "document.ingested_via_api" | "document.reindex_queued" | "document.deleted" | "ingestion.retry_queued";
    resourceType: "document" | "ingestion_job";
    resourceId: string;
    requestId: string;
    metadata: Record<string, string | number | boolean | null>;
  }): Promise<void>;
}
