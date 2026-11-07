import { createHash } from "node:crypto";
import { z } from "zod";
import {
  ExistingIngestionSourceError,
  UploadAdmissionError,
  type IngestionJobRepository,
  type EnqueueOptions,
} from "../ports/ingestion-job-repository.js";
import type { OriginalFileStore } from "../../../knowledge/index.js";
import { recordOperationalEvent } from "../../../../platform/observability/observer.js";

const keySchema = z
  .string()
  .min(16)
  .max(128)
  .regex(/^[A-Za-z0-9_-]+$/);
const digest = (value: string | Buffer) =>
  createHash("sha256").update(value).digest("hex");
export class QueueDocumentUploadUseCase {
  constructor(
    private readonly jobs: IngestionJobRepository,
    private readonly originals: OriginalFileStore,
    private readonly uploadLimit?: number,
  ) {}
  async execute({
    onlyIfMissing,
    idempotencyKey,
    actorId,
    ...input
  }: {
    tenantId: string;
    source: string;
    title?: string;
    filename: string;
    mimeType: string;
    payload: Buffer;
    onlyIfMissing?: true;
    idempotencyKey?: string;
    actorId?: string;
  }) {
    const requestHash = digest(
      JSON.stringify([
        input.source,
        input.title ?? null,
        input.filename,
        input.mimeType,
        digest(input.payload),
      ]),
    );
    const keyHash = digest(
      JSON.stringify([
        actorId ?? "system",
        idempotencyKey ? keySchema.parse(idempotencyKey) : requestHash,
      ]),
    );
    const options: EnqueueOptions = {
      ...(onlyIfMissing ? { onlyIfMissing } : {}),
      admission: {
        keyHash,
        requestHash,
        ...(actorId && this.uploadLimit
          ? {
              quota: {
                actorKey: actorId,
                bytes: input.payload.length,
                limit: this.uploadLimit,
              },
            }
          : {}),
      },
    };
    const prior = await this.jobs.findIdempotent?.(input.tenantId, {
      keyHash,
      requestHash,
    });
    if (prior) {
      recordOperationalEvent({
        operation: "upload",
        outcome: "deduplicated",
        reason: "same_request",
      });
      return prior;
    }
    let storagePath: string | null = null;
    if (this.originals.isEnabled()) {
      storagePath = `uploads/${input.tenantId}/${keyHash}/${requestHash}-${safeFilename(input.filename)}`;
      await this.originals.put({
        path: storagePath,
        contentType: input.mimeType,
        payload: input.payload,
      });
    }
    let job: Awaited<ReturnType<IngestionJobRepository["enqueue"]>>;
    try {
      job = await this.jobs.enqueue(
        {
          ...input,
          title: input.title ?? null,
          payload: storagePath ? null : input.payload,
          storagePath,
        },
        options,
      );
    } catch (error) {
      // An unknown database commit must never cause deletion of an accepted original.
      const referenced =
        storagePath && this.jobs.usesStoragePath
          ? await this.jobs
              .usesStoragePath(input.tenantId, storagePath)
              .catch(() => true)
          : !(
              error instanceof ExistingIngestionSourceError ||
              error instanceof UploadAdmissionError
            );
      if (storagePath && !referenced)
        await this.originals.remove(storagePath).catch(() => {});
      throw error;
    }
    if (storagePath && job.storagePath !== storagePath)
      await this.originals.remove(storagePath).catch(() => {});
    return job;
  }
}
function safeFilename(filename: string) {
  return (
    filename
      .normalize("NFKD")
      .replace(/[^a-zA-Z0-9._-]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 120) || "upload"
  );
}
