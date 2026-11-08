import { z } from "zod";
import { IntegrationFailure } from "../../../../platform/integrations/retry-policy.js";

const finiteVector = z.array(z.number());

/** Bound item validation to the trusted index dimension before allocating issues. */
export function decodeEmbeddingVector(value: unknown, dimensions: number): number[] {
  if (!Number.isSafeInteger(dimensions) || dimensions < 1 || !Array.isArray(value) || value.length !== dimensions)
    throw new IntegrationFailure("invalid_response");
  const result = finiteVector.safeParse(value);
  if (!result.success) throw new IntegrationFailure("invalid_response");
  // pgvector stores float32 coordinates; cosine retrieval also needs a nonzero vector.
  if (!result.data.every((coordinate) => Number.isFinite(Math.fround(coordinate))) ||
      !result.data.some((coordinate) => Math.fround(coordinate) !== 0))
    throw new IntegrationFailure("invalid_response");
  return result.data;
}
