import type { Prisma, PrismaClient } from "@prisma/client";
import type { AuditEventRepository } from "../../application/ports/audit-event-repository.js";

/** Append-only audit port. Authorization and safe metadata belong to its callers. */
export class PrismaAuditEventRepository implements AuditEventRepository {
  constructor(private readonly client: Pick<PrismaClient, "auditEvent">) {}

  async record(input: Parameters<AuditEventRepository["record"]>[0]): Promise<void> {
    // Retain the SQL adapter's JSON semantics (including undefined/NaN handling).
    const metadata: Prisma.InputJsonObject = JSON.parse(JSON.stringify(input.metadata));
    await this.client.auditEvent.create({
      data: {
        tenantId: input.tenantId,
        actorUserId: input.actorUserId,
        action: input.action,
        resourceType: input.resourceType,
        resourceId: input.resourceId,
        requestId: input.requestId,
        metadata,
      },
      select: { id: true },
    });
  }
}
