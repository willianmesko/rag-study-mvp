export interface AuditEventRepository {
  record(input: {
    tenantId: string;
    actorUserId: string | null;
    action: "document.upload_queued" | "ingestion.retry_queued";
    resourceType: "ingestion_job";
    resourceId: string;
    requestId: string;
    metadata: Record<string, string | number | boolean | null>;
  }): Promise<void>;
}
