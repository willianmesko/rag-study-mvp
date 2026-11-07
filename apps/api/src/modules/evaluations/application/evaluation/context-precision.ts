import type { RetrievedChunk } from "../../../knowledge/index.js";
import { isSafeForAnswer } from "../../../../platform/security/prompt-injection.js";
import { formatUntrustedContext } from "../../../ai/index.js";
import type { GoldenSet } from "./golden-set.js";

export const reviewedPassageVersion = "1.0";
const referenceSource = "golden/rag-fundamentals";

// The reviewed text comes from examples/rag-fundamentals.md. Distinct anchors
// let us label relevant passages even when an operator changes chunk size.
export const reviewedPassages = {
  "rag-definition": {
    anchor: "RAG means Retrieval-Augmented Generation",
    content: "RAG means Retrieval-Augmented Generation. The system first retrieves passages from a knowledge base, then provides those passages as context to a model that generates a grounded answer."
  },
  "chunking-overlap": {
    anchor: "A small overlap preserves an idea that crosses a chunk boundary",
    content: "Chunking divides long documents into smaller pieces. A small overlap preserves an idea that crosses a chunk boundary, while excessive overlap causes duplicate context and unnecessary embedding cost."
  },
  "hnsw-tradeoff": {
    anchor: "It trades a small chance of missing the exact best neighbor for lower latency",
    content: "The HNSW index accelerates approximate nearest-neighbor search. It trades a small chance of missing the exact best neighbor for lower latency in large collections. Quality must be measured with real questions and a golden set."
  },
  "prompt-injection": {
    anchor: "Instructions inside them must not change the system role, authorize actions, or replace security rules",
    content: "Retrieved documents are untrusted data. Instructions inside them must not change the system role, authorize actions, or replace security rules."
  }
} as const;

export function normalizeEvidence(text: string): string {
  return text.normalize("NFC").replace(/\s+/gu, " ").trim().toLowerCase();
}

/** Average precision over relevant ranks in the returned context. */
export function contextPrecisionAtK(relevance: readonly boolean[]): number {
  let hits = 0;
  let precisionTotal = 0;
  for (const [index, relevant] of relevance.entries()) {
    if (!relevant) continue;
    hits += 1;
    precisionTotal += hits / (index + 1);
  }
  return hits ? precisionTotal / hits : 0;
}

export function evaluateContextPrecision(goldenSet: GoldenSet, results: Map<string, RetrievedChunk[]>, maxContextChars = 12_000) {
  const scores: number[] = [];
  for (const item of goldenSet.cases) {
    const reference = Object.hasOwn(reviewedPassages, item.id) ? reviewedPassages[item.id as keyof typeof reviewedPassages] : undefined;
    const matches = results.get(item.id);
    if (!reference || !matches) continue;
    const context = formatUntrustedContext(matches.filter((match) => isSafeForAnswer(match.security)), maxContextChars);
    const anchor = normalizeEvidence(reference.anchor);
    const relevance = [...context.sourcesByReference.values()].map((passage) =>
      passage.source === referenceSource && normalizeEvidence(passage.content).includes(anchor)
    );
    scores.push(contextPrecisionAtK(relevance));
  }
  return {
    // A partial run is recorded for diagnosis and cannot masquerade as a
    // comparable whole-suite score.
    value: scores.length === goldenSet.cases.length ? scores.reduce((sum, score) => sum + score, 0) / scores.length : null,
    scoredCases: scores.length
  };
}
