import { createHash } from "node:crypto";
import { performance } from "node:perf_hooks";
import { z } from "zod";
import type { Reranker } from "../../../ai/index.js";
import type { RetrievedChunk } from "../../../knowledge/index.js";
import { redactPii } from "../../../../platform/security/pii-redaction.js";
import { assessPromptInjection, isSafeForAnswer } from "../../../../platform/security/prompt-injection.js";
import { toLexicalQuery } from "../../../knowledge/index.js";

const fixtureId = z.string().regex(/^[a-z][a-z0-9-]{0,39}$/);
const reviewedText = (limit: number) => z.string().trim().min(1).max(limit).refine((value) => redactPii(value).count === 0, {
  message: "Remove detected personal identifiers before creating a replay."
});
const replayCase = z.strictObject({
  id: fixtureId,
  provenance: z.enum(["synthetic", "reviewed-anonymized"]),
  question: reviewedText(400),
  candidates: z.array(z.strictObject({ id: fixtureId, text: reviewedText(800), relevant: z.boolean() })).min(2).max(12)
}).refine(({ candidates }) => new Set(candidates.map(({ id }) => id)).size === candidates.length
  && candidates.some(({ relevant }) => relevant) && candidates.some(({ relevant }) => !relevant), {
  message: "Each case needs distinct passage IDs, relevant evidence, and a distractor."
});

export const replaySuiteSchema = z.strictObject({
  version: z.string().regex(/^\d+\.\d+$/),
  topK: z.number().int().min(1).max(5),
  cases: z.array(replayCase).min(1).max(30)
}).refine(({ cases }) => new Set(cases.map(({ id }) => id)).size === cases.length, { message: "Case IDs must be unique." });

export type ReplaySuite = z.infer<typeof replaySuiteSchema>;
type ReplayCase = ReplaySuite["cases"][number];
const fraction = z.number().min(0).max(1);
export const replayMetricsSchema = z.strictObject({
  hitRate: fraction,
  meanReciprocalRank: fraction,
  recallAtK: fraction,
  precisionAtK: fraction,
  contextPrecision: fraction
});
type ReplayMetrics = z.infer<typeof replayMetricsSchema>;

export function benchmarkFingerprint(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function fixtureRanking(item: ReplayCase): RetrievedChunk[] {
  const query = new Set(toLexicalQuery(item.question).split(" ").filter(Boolean));
  return item.candidates.flatMap(({ id, text }, ordinal) => {
    const security = assessPromptInjection(text);
    if (!isSafeForAnswer(security)) return [];
    const terms = new Set(toLexicalQuery(text).split(" "));
    const overlap = [...query].filter((term) => terms.has(term)).length;
    return [{ chunkId: id, documentId: id, ordinal, content: text, source: id, title: null,
      score: overlap / Math.max(query.size, 1), security }];
  }).sort((left, right) => right.score - left.score || left.ordinal - right.ordinal);
}

export function scoreReplayRanking(rankedIds: string[], relevantIds: Set<string>, topK: number): ReplayMetrics {
  const ids = [...new Set(rankedIds)].slice(0, topK);
  let matches = 0;
  let firstRank = 0;
  let precisionAtRelevantRanks = 0;
  for (const [index, id] of ids.entries()) {
    if (!relevantIds.has(id)) continue;
    const rank = index + 1;
    matches += 1;
    firstRank ||= rank;
    precisionAtRelevantRanks += matches / rank;
  }
  return {
    hitRate: firstRank ? 1 : 0,
    meanReciprocalRank: firstRank ? 1 / firstRank : 0,
    recallAtK: matches / relevantIds.size,
    precisionAtK: matches / topK,
    contextPrecision: precisionAtRelevantRanks / Math.min(topK, relevantIds.size)
  };
}

function aggregate(metrics: ReplayMetrics[]): ReplayMetrics {
  const totals = { hitRate: 0, meanReciprocalRank: 0, recallAtK: 0, precisionAtK: 0, contextPrecision: 0 };
  const keys = Object.keys(totals) as (keyof ReplayMetrics)[];
  for (const result of metrics) {
    for (const key of keys) totals[key] += result[key];
  }
  for (const key of keys) totals[key] /= metrics.length;
  return totals;
}

export async function evaluateReplay(suite: ReplaySuite, reranker?: Reranker, signal?: AbortSignal) {
  if (reranker && suite.cases.some(({ provenance }) => provenance !== "synthetic")) {
    throw new Error("External reranking requires a synthetic replay suite.");
  }
  const baselineScores: ReplayMetrics[] = [];
  const rerankedScores: ReplayMetrics[] = [];
  const cases: { id: string; baseline: ReplayMetrics; reranked?: ReplayMetrics; rerankMs?: number }[] = [];
  for (const item of suite.cases) {
    signal?.throwIfAborted();
    const candidates = fixtureRanking(item);
    const relevant = new Set(item.candidates.filter(({ relevant }) => relevant).map(({ id }) => id));
    const baseline = scoreReplayRanking(candidates.map(({ chunkId }) => chunkId), relevant, suite.topK);
    baselineScores.push(baseline);
    if (!reranker) {
      cases.push({ id: item.id, baseline });
      continue;
    }
    const startedAt = performance.now();
    const reordered = await reranker.rerank({ query: item.question, candidates, limit: suite.topK, signal });
    const reranked = scoreReplayRanking(reordered.map(({ chunkId }) => chunkId), relevant, suite.topK);
    rerankedScores.push(reranked);
    cases.push({ id: item.id, baseline, reranked, rerankMs: Math.round(performance.now() - startedAt) });
  }
  return {
    baseline: aggregate(baselineScores),
    ...(reranker ? { reranked: aggregate(rerankedScores) } : {}),
    cases
  };
}
