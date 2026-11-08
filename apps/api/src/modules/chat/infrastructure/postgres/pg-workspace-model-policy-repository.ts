import { workspaceChatModelPolicySchema, type WorkspaceChatModelPolicy } from "@rag-study/contracts";
import type { Pool } from "pg";
import { z } from "zod";
import { decodeStoredRecord } from "../../../../platform/database/stored-record.js";
import type { WorkspaceModelPolicyRepository } from "../../application/ports/workspace-model-policy-repository.js";

const policyRow = z.object({ policy: workspaceChatModelPolicySchema });

export class PgWorkspaceModelPolicyRepository implements WorkspaceModelPolicyRepository {
  constructor(private readonly pool: Pool) {}

  async get(tenantId: string): Promise<WorkspaceChatModelPolicy | null> {
    const { rows } = await this.pool.query<Record<string, unknown>>(
      "SELECT policy FROM workspace_chat_model_policies WHERE tenant_id = $1", [tenantId]
    );
    return rows.length ? decodeStoredRecord(policyRow, rows[0]).policy : null;
  }

  async save(tenantId: string, policy: WorkspaceChatModelPolicy): Promise<WorkspaceChatModelPolicy> {
    const { rows } = await this.pool.query<Record<string, unknown>>(
      `INSERT INTO workspace_chat_model_policies (tenant_id, policy)
       VALUES ($1, $2::jsonb)
       ON CONFLICT (tenant_id) DO UPDATE SET policy = EXCLUDED.policy, updated_at = NOW()
       RETURNING policy`,
      [tenantId, JSON.stringify(policy)]
    );
    return decodeStoredRecord(policyRow, rows[0]).policy;
  }
}
