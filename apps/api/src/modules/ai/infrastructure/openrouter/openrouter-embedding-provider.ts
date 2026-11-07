import type {ProviderUsageObserver} from "../../application/ports/answer-generator.js";
import { z } from "zod";
import { IntegrationFailure } from "../../../../platform/integrations/retry-policy.js";
import { decodeEmbeddingVector } from "../embeddings/embedding-response.js";
import type { EmbeddingProvider } from "../../application/ports/embedding-provider.js";
import { defaultProviderHttpClient, type ProviderHttpClient } from "../../../../platform/http/provider-client.js";

const responseSchema = z.object({ data: z.unknown() });
const embeddingRecord = z.object({ embedding: z.unknown() });

export class OpenRouterEmbeddingProvider implements EmbeddingProvider {
  constructor(
    private readonly baseUrl: string,
    private readonly apiKey: string,
    private readonly model: string,
    private readonly dimensions: number,
    private readonly http: ProviderHttpClient = defaultProviderHttpClient
  ) {}

  async embed(text: string, inputType: "document" | "query", signal?: AbortSignal,onUsage?:ProviderUsageObserver): Promise<number[]> {
    const json = await this.http.requestJson(`${this.baseUrl}/embeddings`, {
      method: "POST",
      signal,
      headers: { authorization: `Bearer ${this.apiKey}`, "content-type": "application/json" },
      body: JSON.stringify({ input: text, model: this.model, dimensions: this.dimensions, input_type: inputType === "query" ? "search_query" : "search_document" })
    });
    const measured=z.object({usage:z.object({prompt_tokens:z.number().int().min(0).max(2_147_483_647),cost:z.number().min(0).max(999_999).nullish()})}).safeParse(json);
    if(measured.success)onUsage?.({inputTokens:measured.data.usage.prompt_tokens,outputTokens:0,...(measured.data.usage.cost!=null?{costUsd:measured.data.usage.cost}:{})});
    const parsed = responseSchema.safeParse(json);
    if (!parsed.success || !Array.isArray(parsed.data.data) || parsed.data.data.length !== 1)
      throw new IntegrationFailure("invalid_response");
    const record = embeddingRecord.safeParse(parsed.data.data[0]);
    if (!record.success) throw new IntegrationFailure("invalid_response");
    return decodeEmbeddingVector(record.data.embedding, this.dimensions);
  }
}
