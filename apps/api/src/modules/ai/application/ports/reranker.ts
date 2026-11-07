import type {ProviderUsageObserver} from "./answer-generator.js";
import type { RetrievedChunk } from "../../../knowledge/index.js";

export type RerankInput = {
  query: string;
  candidates: RetrievedChunk[];
  limit: number;
  signal?: AbortSignal;
  onUsage?:ProviderUsageObserver;
};

export interface Reranker {
  readonly enabled: boolean;
  rerank(input: RerankInput): Promise<RetrievedChunk[]>;
}
