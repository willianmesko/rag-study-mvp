import type { z } from "zod";
import { ApiError } from "./api-error";

function invalidResponse() {
  // Zod issues may contain returned values. Do not retain them in errors or logs.
  return new ApiError("Lumora received an invalid response. Try again in a moment.", 502, "invalid_response");
}

export function decodeApiResponse<T>(schema: z.ZodType<T>, payload: unknown): T {
  const parsed = schema.safeParse(payload);
  if (!parsed.success) throw invalidResponse();
  return parsed.data;
}

export async function readJsonResponse(response: Response): Promise<unknown> {
  try {
    const payload: unknown = await response.json();
    return payload;
  } catch (error) {
    if (error instanceof SyntaxError) throw invalidResponse();
    throw error;
  }
}
