import type {ProviderUsageObserver} from "../../application/ports/answer-generator.js";
import { z } from "zod";
import type { EmbeddingProvider } from "../../application/ports/embedding-provider.js";
import { requestProviderJson } from "../http/provider-client.js";

const responseSchema = z.object({ data: z.array(z.object({ embedding: z.array(z.number()) })).min(1) });

export class OpenRouterEmbeddingProvider implements EmbeddingProvider {
  constructor(
    private readonly baseUrl: string,
    private readonly apiKey: string,
    private readonly model: string,
    private readonly dimensions: number
  ) {}

  async embed(text: string, inputType: "document" | "query", signal?: AbortSignal,onUsage?:ProviderUsageObserver): Promise<number[]> {
    const json = await requestProviderJson(`${this.baseUrl}/embeddings`, {
      method: "POST",
      signal,
      headers: { authorization: `Bearer ${this.apiKey}`, "content-type": "application/json" },
      body: JSON.stringify({ input: text, model: this.model, dimensions: this.dimensions, input_type: inputType === "query" ? "search_query" : "search_document" })
    });
    const measured=z.object({usage:z.object({prompt_tokens:z.number().int().min(0).max(2_147_483_647),cost:z.number().min(0).max(999_999).nullish()})}).safeParse(json);
    if(measured.success)onUsage?.({inputTokens:measured.data.usage.prompt_tokens,outputTokens:0,...(measured.data.usage.cost!=null?{costUsd:measured.data.usage.cost}:{})});
    const embedding = responseSchema.parse(json).data[0]?.embedding;
    if (!embedding || embedding.length !== this.dimensions) {
      throw new Error(`OpenRouter returned an embedding with an unexpected dimension for ${this.model}.`);
    }
    return embedding;
  }
}
