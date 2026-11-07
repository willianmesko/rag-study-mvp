import type {ProviderUsageObserver} from "../../application/ports/answer-generator.js";
import { z } from "zod";
import type { EmbeddingProvider } from "../../application/ports/embedding-provider.js";
import { requestProviderJson } from "../../../../platform/http/provider-client.js";

const responseSchema = z.object({ embeddings: z.array(z.array(z.number())).min(1) });

export class OllamaEmbeddingProvider implements EmbeddingProvider {
  constructor(
    private readonly baseUrl: string,
    private readonly model: string,
    private readonly dimensions: number
  ) {}

  async embed(text: string, _inputType: "document" | "query", signal?: AbortSignal,onUsage?:ProviderUsageObserver): Promise<number[]> {
    const json = await requestProviderJson(`${this.baseUrl}/api/embed`, {
      method: "POST",
      signal,
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ model: this.model, input: text, dimensions: this.dimensions })
    });
    const measured=z.object({prompt_eval_count:z.number().int().nonnegative()}).safeParse(json);
    if(measured.success)onUsage?.({inputTokens:measured.data.prompt_eval_count,outputTokens:0});
    const embedding = responseSchema.parse(json).embeddings[0];
    if (!embedding || embedding.length !== this.dimensions) {
      throw new Error(`Ollama returned an embedding with an unexpected dimension for ${this.model}.`);
    }
    return embedding;
  }
}
