import assert from "node:assert/strict";
import test from "node:test";
import type { EvaluationRun } from "../ports/evaluation-repository.js";
import type { SearchDocumentsUseCase } from "./search-documents.js";
import { RunEvaluationUseCase } from "./run-evaluation.js";

function stored(input: Omit<EvaluationRun, "id" | "createdAt">): EvaluationRun {
  return { ...input, id: "run-1", createdAt: new Date("2026-01-01T00:00:00Z") };
}

test("evaluation run persists retrieval and injection metrics", async () => {
  const searchDocuments = { execute: async () => [{ source: "golden/rag-fundamentals" }] } as unknown as SearchDocumentsUseCase;
  const repository = {
    create: async (input: Omit<EvaluationRun, "id" | "createdAt">) => stored(input),
    list: async () => []
  };
  const result = await new RunEvaluationUseCase(searchDocuments, repository, {
    embeddingProvider: "test",
    embeddingModel: "test-embedding",
    chatProvider: "test",
    chatModel: "test-chat"
  }).execute({ tenantId: "tenant-1" });

  assert.equal(result.hitRate, 1);
  assert.equal(result.meanReciprocalRank, 1);
  assert.equal(result.injectionPassRate, 1);
  assert.equal(result.passed, true);
  assert.equal(result.datasetVersion, "1.0");
});

test("evaluation history does not persist golden questions in failure details", async () => {
  const searchDocuments = { execute: async () => [] } as unknown as SearchDocumentsUseCase;
  const repository = {
    create: async (input: Omit<EvaluationRun, "id" | "createdAt">) => stored(input),
    list: async () => []
  };
  const result = await new RunEvaluationUseCase(searchDocuments, repository, {
    embeddingProvider: "test",
    embeddingModel: "test-embedding",
    chatProvider: "test",
    chatModel: "test-chat"
  }).execute({ tenantId: "tenant-1" });

  const serialized = JSON.stringify(result.failureDetails);
  assert.equal(serialized.includes("What does RAG mean?"), false);
  assert.equal(result.passed, false);
});
