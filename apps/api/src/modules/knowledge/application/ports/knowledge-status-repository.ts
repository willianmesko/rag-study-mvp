import type { KnowledgeStatus } from "@rag-study/contracts";

/** A workspace-scoped read model, independent of paginated document/job lists. */
export interface KnowledgeStatusRepository {
  get(tenantId: string): Promise<KnowledgeStatus>;
}
