import { z } from "zod";
import type { Reranker, RerankInput } from "../../application/ports/reranker.js";
import type { RetrievedChunk } from "../../../knowledge/index.js";
import { redactPii } from "../../../../platform/security/pii-redaction.js";
import { defaultProviderHttpClient, type ProviderHttpClient } from "../../../../platform/http/provider-client.js";
import { IntegrationFailure } from "../../../../platform/integrations/retry-policy.js";

const responseEnvelope = z.object({ results: z.unknown() });
const resultsSchema = z.array(z.object({
    index: z.number().int().min(0).max(2_147_483_647),
    relevance_score: z.number()
  }));

export class JinaReranker implements Reranker {
  readonly enabled = true;

  constructor(
    private readonly baseUrl: string,
    private readonly apiKey: string,
    private readonly model: string,
    private readonly http: ProviderHttpClient = defaultProviderHttpClient
  ) {}

  async rerank(input: RerankInput): Promise<RetrievedChunk[]> {
    if (input.candidates.length === 0) return [];
    if (!Number.isSafeInteger(input.limit) || input.limit < 1) throw new Error("Reranking requires a positive integer result limit.");
    const requestedResults = Math.min(input.limit, input.candidates.length);

    const json = await this.http.requestJson(`${this.baseUrl}/rerank`, {
      method: "POST",
      signal: input.signal,
      headers: { authorization: `Bearer ${this.apiKey}`, "content-type": "application/json" },
      body: JSON.stringify({
        model: this.model,
        query: redactPii(input.query).text,
        documents: input.candidates.map((candidate) => redactPii(candidate.content).text),
        top_n: requestedResults,
        return_documents: false
      })
    });
    const measured=z.object({usage:z.object({total_tokens:z.number().int().min(0).max(2_147_483_647)})}).safeParse(json);
    if(measured.success)input.onUsage?.({inputTokens:measured.data.usage.total_tokens,outputTokens:0});
    const envelope = responseEnvelope.safeParse(json);
    if (!envelope.success || !Array.isArray(envelope.data.results) || envelope.data.results.length > requestedResults)
      throw new IntegrationFailure("invalid_response");
    const parsed = resultsSchema.safeParse(envelope.data.results);
    if (!parsed.success) throw new IntegrationFailure("invalid_response");
    const results = parsed.data;
    const usedIndexes = new Set<number>();

    return results.map((result, index) => {
      const candidate = input.candidates[result.index];
      if (!candidate || usedIndexes.has(result.index)) {
        throw new IntegrationFailure("invalid_response");
      }
      usedIndexes.add(result.index);
      return {
        ...candidate,
        reranker: { rank: index + 1, score: result.relevance_score }
      };
    });
  }
}
