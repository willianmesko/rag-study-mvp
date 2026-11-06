import assert from "node:assert/strict";
import test from "node:test";
import { invalidCitationsAnswer } from "../policies/structured-answer.js";
import type { AnswerQuestionResult, AnswerWorkflowEvent } from "../ports/question-answering-workflow.js";
import type { SemanticAnswerCache, SemanticCacheEntry } from "../ports/semantic-answer-cache.js";
import { AnswerQuestionUseCase } from "./answer-question.js";

const groundedAnswer: AnswerQuestionResult = {
  answer: "RAG uses relevant passages.",
  sources: [{
    chunkId: "chunk-1", documentId: "document-1", source: "guide.md", title: null,
    ordinal: 0, score: 0.9, content: "RAG uses relevant passages."
  }],
  citedChunkIds: ["chunk-1"],
  structuredOutput: true
};

function makeUseCase({ cached, generated }: { cached: SemanticCacheEntry | null; generated: AnswerQuestionResult }) {
  const writes: Parameters<SemanticAnswerCache["put"]>[0][] = [];
  const usageCacheHits: boolean[] = [];
  const events: AnswerWorkflowEvent[] = [];
  let generations = 0;
  const useCase = new AnswerQuestionUseCase(
    { answer: async () => { generations += 1; return generated; } },
    { embed: async () => [1] },
    {
      findSimilar: async () => cached,
      put: async (entry) => { writes.push(entry); },
      invalidateTenant: async () => undefined
    },
    {
      record: async ({ cacheHit }) => { usageCacheHits.push(cacheHit); },
      summarize: async () => { throw new Error("Usage summary is unrelated to answering"); }
    },
    {
      cacheTtlSeconds: 60, cacheMinimumSimilarity: 0.95, provider: "test", model: "test",
      maxOutputTokens: 100, maxEstimatedCostUsd: 0.1, inputCostPer1kUsd: 0, outputCostPer1kUsd: 0
    }
  );

  return {
    writes, usageCacheHits, events,
    get generations() { return generations; },
    execute: () => useCase.execute({
      question: "How does RAG work?", tenantId: "tenant-1", actorKey: "actor-1",
      onEvent: (event) => { events.push(event); }
    })
  };
}

test("legacy cached invalid-citation refusals with sources are regenerated", async () => {
  const useCase = makeUseCase({
    cached: { answer: invalidCitationsAnswer, sources: groundedAnswer.sources, similarity: 1 },
    generated: groundedAnswer
  });

  assert.deepEqual(await useCase.execute(), groundedAnswer);
  assert.equal(useCase.generations, 1);
  assert.equal(useCase.writes[0]?.answer, groundedAnswer.answer);
  assert.deepEqual(useCase.events, []);
  assert.deepEqual(useCase.usageCacheHits, [false]);
});

test("legacy cache entries without supporting passages are regenerated", async () => {
  const useCase = makeUseCase({
    cached: { answer: "I could not find enough context.", sources: [], similarity: 1 },
    generated: groundedAnswer
  });

  assert.deepEqual(await useCase.execute(), groundedAnswer);
  assert.equal(useCase.generations, 1);
});

test("new refusals are returned without being cached even when they contain sources", async () => {
  const refusal = {
    answer: invalidCitationsAnswer, sources: groundedAnswer.sources,
    refusalReason: "invalid_citations"
  };
  const useCase = makeUseCase({ cached: null, generated: refusal });

  assert.deepEqual(await useCase.execute(), refusal);
  assert.equal(useCase.writes.length, 0);
});

test("valid existing cached answers remain usable", async () => {
  const { answer, sources } = groundedAnswer;
  const useCase = makeUseCase({ cached: { answer, sources, similarity: 1 }, generated: groundedAnswer });

  assert.deepEqual(await useCase.execute(), { answer, sources });
  assert.equal(useCase.generations, 0);
  assert.deepEqual(useCase.events.map(({ type }) => type), ["cached", "validating"]);
  assert.deepEqual(useCase.usageCacheHits, [true]);
});
