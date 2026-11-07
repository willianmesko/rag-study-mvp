import type { RetrievedChunk } from "../../domain/document.js";

export type RerankInput = {
  query: string;
  candidates: RetrievedChunk[];
  limit: number;
  signal?: AbortSignal;
};

export interface Reranker {
  readonly enabled: boolean;
  rerank(input: RerankInput): Promise<RetrievedChunk[]>;
}
