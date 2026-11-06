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

  async embed(text: string, inputType: "document" | "query"): Promise<number[]> {
    const json = await requestProviderJson(`${this.baseUrl}/embeddings`, {
      method: "POST",
      headers: { authorization: `Bearer ${this.apiKey}`, "content-type": "application/json" },
      body: JSON.stringify({ input: text, model: this.model, dimensions: this.dimensions, input_type: inputType === "query" ? "search_query" : "search_document" })
    });
    const embedding = responseSchema.parse(json).data[0]?.embedding;
    if (!embedding || embedding.length !== this.dimensions) {
      throw new Error(`OpenRouter returned an embedding with an unexpected dimension for ${this.model}.`);
    }
    return embedding;
  }
}
