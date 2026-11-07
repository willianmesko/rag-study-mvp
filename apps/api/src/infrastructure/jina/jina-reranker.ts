import { z } from "zod";
import type { Reranker, RerankInput } from "../../application/ports/reranker.js";
import type { RetrievedChunk } from "../../domain/document.js";
import { redactPii } from "../../domain/security/pii-redaction.js";
import { requestProviderJson } from "../http/provider-client.js";

const responseSchema = z.object({
  results: z.array(z.object({
    index: z.number().int().nonnegative(),
    relevance_score: z.number()
  }))
});

export class JinaReranker implements Reranker {
  readonly enabled = true;

  constructor(
    private readonly baseUrl: string,
    private readonly apiKey: string,
    private readonly model: string
  ) {}

  async rerank(input: RerankInput): Promise<RetrievedChunk[]> {
    if (input.candidates.length === 0) return [];

    const json = await requestProviderJson(`${this.baseUrl}/rerank`, {
      method: "POST",
      signal: input.signal,
      headers: { authorization: `Bearer ${this.apiKey}`, "content-type": "application/json" },
      body: JSON.stringify({
        model: this.model,
        query: redactPii(input.query).text,
        documents: input.candidates.map((candidate) => redactPii(candidate.content).text),
        top_n: Math.min(input.limit, input.candidates.length),
        return_documents: false
      })
    });
    const results = responseSchema.parse(json).results;
    const usedIndexes = new Set<number>();

    return results.map((result, index) => {
      const candidate = input.candidates[result.index];
      if (!candidate || usedIndexes.has(result.index)) {
        throw new Error("Jina returned an invalid reranking result.");
      }
      usedIndexes.add(result.index);
      return {
        ...candidate,
        reranker: { rank: index + 1, score: result.relevance_score }
      };
    });
  }
}
