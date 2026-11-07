import type {ProviderUsageObserver} from "../../application/ports/answer-generator.js";
import { z } from "zod";
import { IntegrationFailure } from "../../../../platform/integrations/retry-policy.js";
import { decodeEmbeddingVector } from "../embeddings/embedding-response.js";
import type { EmbeddingProvider } from "../../application/ports/embedding-provider.js";
import { defaultProviderHttpClient, type ProviderHttpClient } from "../../../../platform/http/provider-client.js";

const responseSchema = z.object({ embeddings: z.unknown() });

export class OllamaEmbeddingProvider implements EmbeddingProvider {
  constructor(
    private readonly baseUrl: string,
    private readonly model: string,
    private readonly dimensions: number,
    private readonly http: ProviderHttpClient = defaultProviderHttpClient
  ) {}

  async embed(text: string, _inputType: "document" | "query", signal?: AbortSignal,onUsage?:ProviderUsageObserver): Promise<number[]> {
    const json = await this.http.requestJson(`${this.baseUrl}/api/embed`, {
      method: "POST",
      signal,
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ model: this.model, input: text, dimensions: this.dimensions })
    });
    const measured=z.object({prompt_eval_count:z.number().int().min(0).max(2_147_483_647)}).safeParse(json);
    if(measured.success)onUsage?.({inputTokens:measured.data.prompt_eval_count,outputTokens:0});
    const parsed = responseSchema.safeParse(json);
    if (!parsed.success || !Array.isArray(parsed.data.embeddings) || parsed.data.embeddings.length !== 1)
      throw new IntegrationFailure("invalid_response");
    return decodeEmbeddingVector(parsed.data.embeddings[0], this.dimensions);
  }
}
