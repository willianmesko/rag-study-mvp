import type { WorkspaceChatModelPolicy } from "@rag-study/contracts";

export interface WorkspaceModelPolicyRepository {
  get(tenantId: string): Promise<WorkspaceChatModelPolicy | null>;
  save(tenantId: string, policy: WorkspaceChatModelPolicy): Promise<WorkspaceChatModelPolicy>;
}
