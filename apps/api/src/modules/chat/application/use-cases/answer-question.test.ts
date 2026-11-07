import assert from "node:assert/strict";
import test from "node:test";
import { invalidCitationsAnswer } from "../../../ai/application/policies/structured-answer.js";
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
  let cacheReads=0;
  const useCase = new AnswerQuestionUseCase(
    { answer: async () => { generations += 1; return generated; } },
    { embed: async () => [1] },
    {
      findSimilar: async () => {cacheReads++;return cached;},
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
    get cacheReads() {return cacheReads;},
    execute: (bypassCache=false) => useCase.execute({
      bypassCache,
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

  const { usage, ...result } = await useCase.execute();
  assert.deepEqual(result, groundedAnswer);
  assert.equal(usage?.safetyOutcome, "validated");
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

  const { usage: _usage, ...result } = await useCase.execute();
  assert.deepEqual(result, groundedAnswer);
  assert.equal(useCase.generations, 1);
});

test("new refusals are returned without being cached even when they contain sources", async () => {
  const refusal = {
    answer: invalidCitationsAnswer, sources: groundedAnswer.sources,
    refusalReason: "invalid_citations"
  };
  const useCase = makeUseCase({ cached: null, generated: refusal });

  const { usage, ...result } = await useCase.execute();
  assert.deepEqual(result, refusal);
  assert.equal(usage?.safetyOutcome, "refused");
  assert.equal(useCase.writes.length, 0);
});

test("valid existing cached answers remain usable", async () => {
  const { answer, sources } = groundedAnswer;
  const useCase = makeUseCase({ cached: { answer, sources, similarity: 1 }, generated: groundedAnswer });

  const { usage, ...result } = await useCase.execute();
  assert.deepEqual(result, { answer, sources, contextSources: [], cacheHit: true });
  assert.equal(usage?.source, "cache");
  assert.equal(usage?.outputTokens, 0);
  assert.equal(useCase.generations, 0);
  assert.deepEqual(useCase.events.map(({ type }) => type), ["cached", "validating"]);
  assert.deepEqual(useCase.usageCacheHits, [true]);
});

test("legacy cache entries are redacted on read and do not publish validated citations", async () => {
  const useCase = makeUseCase({
    cached: { answer: "Write to user@example.com", sources: groundedAnswer.sources, similarity: 1 },
    generated: groundedAnswer
  });
  const answer = await useCase.execute();
  assert.equal(answer.answer, "Write to [REDACTED_EMAIL]");
  assert.deepEqual(useCase.events.map(({ type }) => type), ["cached", "validating"]);
});

test("generated answer text is redacted before it is returned and cached", async () => {
  const useCase = makeUseCase({ cached: null, generated: { ...groundedAnswer, answer: "Write to user@example.com" } });
  assert.equal((await useCase.execute()).answer, "Write to [REDACTED_EMAIL]");
  assert.equal(useCase.writes[0]?.answer, "Write to [REDACTED_EMAIL]");
});

test("fresh model context is returned without being stored in the answer cache", async () => {
  const generated = {
    ...groundedAnswer,
    contextSources: [groundedAnswer.sources[0]!, { ...groundedAnswer.sources[0]!, chunkId: "uncited-chunk" }]
  };
  const useCase = makeUseCase({ cached: null, generated });

  const { usage: _usage, ...result } = await useCase.execute();
  assert.deepEqual(result, generated);
  assert.deepEqual(useCase.writes[0]?.sources, groundedAnswer.sources);
  assert.equal("contextSources" in useCase.writes[0]!, false);
});

// Private history must be deletable without leaving an answer in a shared cache.
test("a saved conversation bypasses workspace cache reads and writes even on its first question",async()=>{
  const useCase=makeUseCase({cached:{answer:"Another member's answer",sources:groundedAnswer.sources,similarity:1},generated:groundedAnswer});
  assert.equal((await useCase.execute(true)).answer,groundedAnswer.answer);
  assert.equal(useCase.cacheReads,0);assert.equal(useCase.writes.length,0);assert.equal(useCase.generations,1);
});
