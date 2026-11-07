import type { RetrievedChunk } from "../../domain/document.js";
import type { SearchDocumentsUseCase } from "../use-cases/search-documents.js";
import { dashboardGoldenSet } from "./default-evaluation-suites.js";
export type EvaluationEmbeddingIdentity = {
  provider: string;
  model: string;
  version?: string;
};
export type ReferenceRetrieval = {
  resultsByCaseId: Map<string, RetrievedChunk[]>;
  retrievalErrors: Array<{ id: string; code: string }>;
  index?: EvaluationEmbeddingIdentity;
};
export async function retrieveReferenceCases(
  search: Pick<SearchDocumentsUseCase, "execute">,
  tenantId: string,
  identity?: (
    tenantId: string,
  ) => Promise<EvaluationEmbeddingIdentity | undefined>,
  signal?: AbortSignal,
): Promise<ReferenceRetrieval> {
  signal?.throwIfAborted();
  const index = await identity?.(tenantId);
  const outcomes = await Promise.allSettled(
    dashboardGoldenSet.cases.map((item) =>
      search.execute({ query: item.question, tenantId, topK: 5, signal }),
    ),
  );
  signal?.throwIfAborted();
  const current = await identity?.(tenantId);
  const changed =
    index?.version !== current?.version ||
    index?.provider !== current?.provider ||
    index?.model !== current?.model;
  const resultsByCaseId = new Map<string, RetrievedChunk[]>(),
    retrievalErrors: ReferenceRetrieval["retrievalErrors"] = [];
  for (const [position, outcome] of outcomes.entries()) {
    const id = dashboardGoldenSet.cases[position]!.id;
    if (changed) retrievalErrors.push({ id, code: "embedding_index_changed" });
    else if (outcome.status === "fulfilled")
      resultsByCaseId.set(id, outcome.value);
    else retrievalErrors.push({ id, code: "retrieval_failed" });
  }
  return { resultsByCaseId, retrievalErrors, index };
}
