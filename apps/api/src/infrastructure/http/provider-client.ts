import { z } from "zod";
import { config } from "../../config.js";

export const maxProviderResponseBytes = 2 * 1024 * 1024;

const errorBody = z.object({ error: z.unknown().optional(), message: z.string().optional(), detail: z.string().optional() }).passthrough();

export function providerRequestSignal(signal?: AbortSignal | null): AbortSignal {
  const deadline = AbortSignal.timeout(config.PROVIDER_TIMEOUT_MS);
  return signal ? AbortSignal.any([signal, deadline]) : deadline;
}

export async function requestProviderJson(url: string, init: RequestInit): Promise<unknown> {
  let response: Response;
  try {
    response = await fetch(url, { ...init, signal: providerRequestSignal(init.signal) });
  } catch (error) {
    if (error instanceof DOMException && error.name === "TimeoutError") {
      throw new Error("Provider request timed out.");
    }
    throw error;
  }
  const text = await boundedResponseText(response,response.ok ? maxProviderResponseBytes : 32_768);
  if (response.ok) return JSON.parse(text);

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

async function boundedResponseText(response:Response,maxBytes:number):Promise<string> {
  if (!response.body) throw new Error('The provider returned an empty body.');
  const reader=response.body.getReader();const chunks:Uint8Array[]=[];let bytes=0;
  try {
    while(true) {
      const {done,value}=await reader.read();if(done)break;
      bytes += value.byteLength;
      if(bytes>maxBytes) throw new Error('The provider response exceeded its size limit.');
      chunks.push(value);
    }
    return Buffer.concat(chunks,bytes).toString('utf8');
  } finally {await reader.cancel().catch(()=>undefined);reader.releaseLock();}
}
