import { z } from "zod";
import { config } from "../../config.js";

const errorBody = z.object({ error: z.unknown().optional(), message: z.string().optional(), detail: z.string().optional() }).passthrough();

export async function requestProviderJson(url: string, init: RequestInit): Promise<unknown> {
  let response: Response;
  try {
    response = await fetch(url, { ...init, signal: AbortSignal.timeout(config.PROVIDER_TIMEOUT_MS) });
  } catch (error) {
    if (error instanceof DOMException && error.name === "TimeoutError") {
      throw new Error("Provider request timed out.");
    }
    throw error;
  }
  if (response.ok) return response.json();

  const text = await response.text();
  let body: unknown = {};
  try {
    body = JSON.parse(text || "{}");
  } catch {
    body = {};
  }
  const parsed = errorBody.safeParse(body);
  const detail = parsed.success ? parsed.data.message ?? parsed.data.detail ?? JSON.stringify(parsed.data.error ?? "") : text;
  throw new Error(`Provider request failed (${response.status}): ${detail.slice(0, 300)}`);
}
