import { z, type ZodType } from "zod";

// pg numeric returns decimal strings; never coerce absent/empty data to zero.
export const storedRatioSchema = z.union([
  z.number(), z.string().max(80).regex(/^-?\d+(?:\.\d+)?$/).transform(Number)
]).pipe(z.number().min(0).max(1));

/** Keep decoder details and stored values out of HTTP errors and operational logs. */
export class StoredRecordError extends Error {
  readonly code = "invalid_stored_record";
  constructor() { super("Stored data failed validation."); this.name = "StoredRecordError"; }
}

export function decodeStoredRecord<T>(schema: ZodType<T>, value: unknown): T {
  const result = schema.safeParse(value);
  if (!result.success) throw new StoredRecordError();
  return result.data;
}
