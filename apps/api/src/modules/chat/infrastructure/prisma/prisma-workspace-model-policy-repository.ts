import type { PrismaClient, Prisma } from "@prisma/client";
import { workspaceChatModelPolicySchema, type WorkspaceChatModelPolicy } from "@rag-study/contracts";
import { decodeStoredRecord } from "../../../../platform/database/stored-record.js";
import type { WorkspaceModelPolicyRepository } from "../../application/ports/workspace-model-policy-repository.js";

/** The caller authorizes workspace membership; every persistence operation also scopes by tenant. */
export class PrismaWorkspaceModelPolicyRepository implements WorkspaceModelPolicyRepository {
  constructor(private readonly client: Pick<PrismaClient, "workspaceChatModelPolicy">) {}

  async get(tenantId: string): Promise<WorkspaceChatModelPolicy | null> {
    const row = await this.client.workspaceChatModelPolicy.findUnique({
      where: { tenantId }, select: { policy: true },
    });
    return row ? decodeStoredRecord(workspaceChatModelPolicySchema, row.policy) : null;
  }

  async save(tenantId: string, value: WorkspaceChatModelPolicy): Promise<WorkspaceChatModelPolicy> {
    const policy = workspaceChatModelPolicySchema.parse(value);
    const data: Prisma.InputJsonObject = { ...policy };
    const row = await this.client.workspaceChatModelPolicy.upsert({
      where: { tenantId }, create: { tenantId, policy: data },
      update: { policy: data, updatedAt: new Date() }, select: { policy: true },
    });
    return decodeStoredRecord(workspaceChatModelPolicySchema, row.policy);
  }
}
