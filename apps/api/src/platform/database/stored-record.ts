import type { ZodType } from "zod";

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
