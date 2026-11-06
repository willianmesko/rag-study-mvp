import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { z } from "zod";
import { chunkText } from "../../domain/chunk.js";
import { toLexicalQuery } from "../../application/policies/lexical-query.js";
import { evaluateRetrieval, goldenSetSchema } from "../../application/evaluation/golden-set.js";
import type { RetrievedChunk } from "../../domain/document.js";

const manifestSchema = z.object({
  version: z.string().min(1),
  documents: z.array(z.object({ source: z.string().min(1), path: z.string().min(1) })).min(1)
});

const [goldenPath, manifestPath] = process.argv.slice(2);
if (!goldenPath || !manifestPath) {
  throw new Error("Usage: npm run eval:golden:ci -- evals/golden-set.v1.json evals/corpus-manifest.v1.json");
}

const goldenSet = goldenSetSchema.parse(JSON.parse(await readFile(resolve(goldenPath), "utf8")));
const manifest = manifestSchema.parse(JSON.parse(await readFile(resolve(manifestPath), "utf8")));
const corpus = await Promise.all(manifest.documents.map(async (document) => ({
  source: document.source,
  chunks: chunkText(await readFile(resolve(document.path), "utf8"), 1_200, 200)
})));

const resultsByCaseId = new Map<string, RetrievedChunk[]>();
for (const item of goldenSet.cases) {
  const queryTerms = new Set(toLexicalQuery(item.question).split(" ").filter(Boolean));
  const candidates = corpus.flatMap(({ source, chunks }) => chunks.map((chunk) => {
    const terms = new Set(toLexicalQuery(chunk.content).split(" ").filter(Boolean));
    const overlap = [...queryTerms].filter((term) => terms.has(term)).length;
    return {
      chunkId: `${source}:${chunk.ordinal}`,
      documentId: source,
      ordinal: chunk.ordinal,
      content: chunk.content,
      source,
      title: null,
      score: overlap / Math.max(queryTerms.size, 1),
      security: { promptInjectionRisk: "low" as const, signals: [] }
    };
  })).filter((candidate) => candidate.score > 0).sort((left, right) => right.score - left.score).slice(0, 5);
  resultsByCaseId.set(item.id, candidates);
}

const report = evaluateRetrieval(goldenSet, resultsByCaseId);
console.log(JSON.stringify({ mode: "deterministic-ci", goldenSet: goldenSet.name, ...report }, null, 2));
if (!report.passed) process.exitCode = 1;
