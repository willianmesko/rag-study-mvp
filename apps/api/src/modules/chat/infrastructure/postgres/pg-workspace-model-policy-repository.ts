import { workspaceChatModelPolicySchema, type WorkspaceChatModelPolicy } from "@rag-study/contracts";
import type { Pool } from "pg";
import type { WorkspaceModelPolicyRepository } from "../../application/ports/workspace-model-policy-repository.js";

export class PgWorkspaceModelPolicyRepository implements WorkspaceModelPolicyRepository {
  constructor(private readonly pool: Pool) {}

  async get(tenantId: string): Promise<WorkspaceChatModelPolicy | null> {
    const { rows } = await this.pool.query<{ policy: unknown }>(
      "SELECT policy FROM workspace_chat_model_policies WHERE tenant_id = $1", [tenantId]
    );
    return rows[0] ? workspaceChatModelPolicySchema.parse(rows[0].policy) : null;
  }

  async save(tenantId: string, policy: WorkspaceChatModelPolicy): Promise<WorkspaceChatModelPolicy> {
    const { rows } = await this.pool.query<{ policy: unknown }>(
      `INSERT INTO workspace_chat_model_policies (tenant_id, policy)
       VALUES ($1, $2::jsonb)
       ON CONFLICT (tenant_id) DO UPDATE SET policy = EXCLUDED.policy, updated_at = NOW()
       RETURNING policy`,
      [tenantId, JSON.stringify(policy)]
    );
    return workspaceChatModelPolicySchema.parse(rows[0]?.policy);
  }
}
