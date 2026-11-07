import { observeOperation, recordOperationalEvent } from "../observability.js";
import { createHash } from "node:crypto";
import { z } from "zod";
import type { TenantRole } from "../ports/tenant-membership-repository.js";
import { IntegrationFailure } from "./retry-policy.js";
export class InvitationDeliveryError extends Error {
  constructor(
    readonly code:
      | "stale_state"
      | "forbidden"
      | "idempotency_conflict"
      | "delivery_pending"
      | "delivery_uncertain"
      | "delivery_rejected"
      | "already_member",
  ) {
    super(
      {
        stale_state:
          "This invitation is no longer current. Refresh the team before sending a new invitation.",
        forbidden: "Workspace owner access is required.",
        idempotency_conflict:
          "This invitation key belongs to a different request.",
        delivery_pending: "This invitation is already being delivered.",
        delivery_uncertain:
          "Invitation delivery is unconfirmed. Review its status before sending another invitation.",
        delivery_rejected:
          "The invitation could not be delivered. Check the email and sender configuration.",
        already_member: "This person already belongs to the workspace.",
      }[code],
    );
    this.name = "InvitationDeliveryError";
  }
}
export type InvitationScope = {
  tenantId: string;
  actorId: string;
  requestId: string;
};
export type InvitationReceipt = {
  userId: string;
  email: string;
  role: TenantRole;
};
export type InvitationLease = InvitationScope & {
  id: string;
  leaseToken: string;
  email: string;
  role: "viewer" | "editor";
};
export interface InvitationDeliveryRepository {
  begin(
    input: InvitationScope & {
      email: string;
      role: "viewer" | "editor";
      keyHash: string;
      requestHash: string;
    },
  ): Promise<{ result: InvitationReceipt } | { lease: InvitationLease }>;
  complete(lease: InvitationLease, userId: string): Promise<InvitationReceipt>;
  fail(
    lease: InvitationLease,
    code: "rate_limited" | "permanent_rejection" | "outcome_unknown",
  ): Promise<void>;
}
export interface InvitationGateway {
  send(email: string): Promise<string>;
}
export class InviteWorkspaceMember {
  constructor(
    private readonly repository: InvitationDeliveryRepository,
    private readonly gateway: InvitationGateway,
  ) {}
  async execute(
    input: InvitationScope & {
      email: string;
      role: "viewer" | "editor";
      idempotencyKey?: string;
    },
  ) {
    const email = z.email().max(320).parse(input.email.trim().toLowerCase()),
      role = z.enum(["viewer", "editor"]).parse(input.role);
    const requestHash = createHash("sha256")
      .update(JSON.stringify([email, role]))
      .digest("hex");
    const key = input.idempotencyKey
      ? z
          .string()
          .min(16)
          .max(128)
          .regex(/^[A-Za-z0-9_-]+$/)
          .parse(input.idempotencyKey)
      : requestHash;
    const keyHash = createHash("sha256").update(key).digest("hex");
    const admitted = await this.repository.begin({
      ...input,
      email,
      role,
      keyHash,
      requestHash,
    });
    if ("result" in admitted) return admitted.result;
    try {
      return await this.repository.complete(
        admitted.lease,
        z
          .uuid()
          .parse(
            await observeOperation(
              {
                kind: "workflow.effect",
                name: "workspace_invitation",
                correlationId: input.requestId,
              },
              () => this.gateway.send(email),
            ),
          ),
      );
    } catch (error) {
      const code =
        error instanceof IntegrationFailure && error.code === "rate_limited"
          ? "rate_limited"
          : error instanceof IntegrationFailure &&
              error.code === "permanent_rejection"
            ? "permanent_rejection"
            : "outcome_unknown";
      await this.repository.fail(admitted.lease, code).catch(() => {});
      recordOperationalEvent({
        operation: "workspace_invitation",
        outcome: code === "rate_limited" ? "retry" : "dead_letter",
        reason: code,
      });
      if (error instanceof InvitationDeliveryError) throw error;
      throw new InvitationDeliveryError(
        code === "outcome_unknown"
          ? "delivery_uncertain"
          : code === "rate_limited"
            ? "delivery_pending"
            : "delivery_rejected",
      );
    }
  }
}
