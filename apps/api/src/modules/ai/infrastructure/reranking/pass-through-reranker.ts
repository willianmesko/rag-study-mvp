import type { Reranker, RerankInput } from "../../application/ports/reranker.js";
import type { RetrievedChunk } from "../../../knowledge/index.js";

/** Default for local study: preserve the first-stage RRF order without any API call. */
export class PassThroughReranker implements Reranker {
  readonly enabled = false;

  async rerank(input: RerankInput): Promise<RetrievedChunk[]> {
    return input.candidates.slice(0, input.limit);
  }
}
