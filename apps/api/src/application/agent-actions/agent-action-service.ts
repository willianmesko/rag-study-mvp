import { createHash } from "node:crypto";
import { z } from "zod";
import type { TenantRole } from "../ports/tenant-membership-repository.js";

export const agentActionInputSchema = z.strictObject({ action: z.literal("run_evaluation") });
export const agentActionIdempotencyKeySchema = z.string().min(16).max(128).regex(/^[A-Za-z0-9_-]+$/);

export type AgentActionScope = { tenantId: string; userId: string; role: TenantRole };
export type AgentActionIdentity = Omit<AgentActionScope, "role"> & { actionId: string };
export type AgentActionStatus = "pending_approval" | "queued" | "running" | "succeeded" | "dead_letter";
export type AgentActionReason = "requested" | "approved" | "started" | "completed" | "approval_expired" | "owner_revoked"
  | "read_failed" | "execution_timeout" | "worker_shutdown" | "lease_expired";

export type AgentActionSnapshot = {
  id: string;
  action: "run_evaluation";
  status: AgentActionStatus;
  attempts: number;
  evaluationRunId: string | null;
  createdAt: Date;
  expiresAt: Date;
  events: Array<{ status: AgentActionStatus; reason: AgentActionReason; at: Date }>;
};

export class AgentActionError extends Error {
  constructor(readonly code: "forbidden" | "not_found" | "conflict" | "rate_limited") {
    super({
      forbidden: "Workspace owner access is required.",
      not_found: "Action not found.",
      conflict: "The workspace already has an active action, or this action cannot be approved.",
      rate_limited: "The workspace has reached its evaluation approval limit."
    }[code]);
    this.name = "AgentActionError";
  }
}

export interface AgentActionRepository {
  request(input: Omit<AgentActionIdentity, "actionId"> & { keyHash: string }): Promise<AgentActionSnapshot>;
  approve(input: AgentActionIdentity): Promise<AgentActionSnapshot>;
  get(input: AgentActionIdentity): Promise<AgentActionSnapshot>;
}

export class AgentActionService {
  constructor(private readonly repository: AgentActionRepository) {}

  request({ tenantId, userId, role, idempotencyKey, input }: AgentActionScope & { idempotencyKey: string; input: unknown }) {
    this.requireOwner(role);
    agentActionInputSchema.parse(input);
    const key = agentActionIdempotencyKeySchema.parse(idempotencyKey);
    const keyHash = createHash("sha256").update(key).digest("hex");
    return this.repository.request({ tenantId, userId, keyHash });
  }

  approve({ tenantId, userId, role, actionId }: AgentActionScope & { actionId: string }) {
    this.requireOwner(role);
    return this.repository.approve({ tenantId, userId, actionId: z.uuid().parse(actionId) });
  }

  get({ tenantId, userId, role, actionId }: AgentActionScope & { actionId: string }) {
    this.requireOwner(role);
    return this.repository.get({ tenantId, userId, actionId: z.uuid().parse(actionId) });
  }

  private requireOwner(role: TenantRole) {
    if (role !== "owner") throw new AgentActionError("forbidden");
  }
}
