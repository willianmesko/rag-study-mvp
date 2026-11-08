import { z } from "zod";
import type { OAuthClient } from "../../application/remote-types.js";
import { safeRedirectUri } from "../../application/oauth.js";
import { decodeStoredRecord } from "../../../../platform/database/stored-record.js";

const clientRowSchema = z.object({
  id: z.string(), name: z.string(), expiresAt: z.date(),
  redirectUris: z.array(z.string().refine(safeRedirectUri)).min(1).max(5)
    .refine((values) => new Set(values).size === values.length),
});

export function decodeOAuthClient(value: unknown): OAuthClient {
  return decodeStoredRecord(clientRowSchema, value);
}
