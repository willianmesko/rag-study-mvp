import { z } from "zod";
import { decodeStoredRecord } from "../../../../platform/database/stored-record.js";
import { readStoredChunkSecurity } from "../../../../platform/database/stored-chunk-security.js";
import type { IndexedOriginal, IngestionPassagePreview } from "../../application/ports/ingestion-job-repository.js";

const originalRowSchema = z.object({
  filename: z.string(), mime_type: z.string(),
  // Driver shape only: preserve bytes and private references without interpretation.
  payload: z.instanceof(Buffer).nullable(), storage_path: z.string().nullable(),
});
const previewRowsSchema = z.array(z.union([
  z.object({ total_chunks: z.number().int().nonnegative(), chunk_id: z.null(), ordinal: z.null(), content: z.null(), metadata: z.null() }),
  z.object({ total_chunks: z.number().int().nonnegative(), chunk_id: z.uuid(), ordinal: z.number().int().nonnegative(), content: z.string().min(1), metadata: z.unknown() }),
])).max(3);

export function decodeIndexedOriginal(value: unknown): IndexedOriginal {
  const row = decodeStoredRecord(originalRowSchema, value);
  return { filename: row.filename, mimeType: row.mime_type, payload: row.payload, storagePath: row.storage_path };
}

export function decodePassagePreview(value: unknown): IngestionPassagePreview | null {
  const rows = decodeStoredRecord(previewRowsSchema, value), first = rows[0];
  if (!first) return null;
  return { totalChunks: first.total_chunks, passages: rows.flatMap((row) => row.chunk_id === null ? [] : [{
    chunkId: row.chunk_id, ordinal: row.ordinal, content: row.content, security: readStoredChunkSecurity(row.metadata),
  }]) };
}
