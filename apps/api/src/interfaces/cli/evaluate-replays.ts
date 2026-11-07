import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { parseArgs } from "node:util";
import { fileURLToPath } from "node:url";
import type { ZodType } from "zod";
import { benchmarkFingerprint, evaluateReplay, replaySuiteSchema } from "../../modules/evaluations/application/evaluation/replay-benchmark.js";
import { compareEvaluationSnapshots, evaluationSnapshotSchema, type EvaluationSnapshot } from "../../modules/evaluations/application/evaluation/evaluation-regression.js";
import { assertReviewedReplayApproved, replayReviewApprovalSchema } from "../../modules/evaluations/application/evaluation/reviewed-replay.js";
import { evaluatePromptInjectionSuite, promptInjectionSuiteSchema } from "../../modules/evaluations/application/evaluation/prompt-injection-suite.js";
import type { Reranker } from "../../modules/ai/application/ports/reranker.js";

const bundledSuite = fileURLToPath(new URL("../../../evals/replays/retrieval.v1.json", import.meta.url));
const securityFixture = fileURLToPath(new URL("../../../evals/security/prompt-injection.v1.json", import.meta.url));
const repository = fileURLToPath(new URL("../../../../../", import.meta.url));

async function readFixture<T>(path: string, schema: ZodType<T>, description: string): Promise<T> {
  const contents = await readFile(path, "utf8");
  let json: unknown;
  try { json = JSON.parse(contents); } catch { throw new Error(`${description} is not valid JSON.`); }
  const result = schema.safeParse(json);
  if (!result.success) {
    const detail = result.error.issues.map(({ path, code }) => `${path.join(".") || "root"} (${code})`).join(", ");
    throw new Error(`${description} did not pass validation: ${detail}`);
  }
  return result.data;
}

const { values } = parseArgs({ options: {
  suite: { type: "string" },
  approval: { type: "string" },
  baseline: { type: "string" },
  report: { type: "string" },
  jina: { type: "boolean" }
} });

if (values.jina && (values.suite || values.approval)) throw new Error("Live Jina evaluation can only use the bundled synthetic suite.");

const [suite, securitySuite, baseline, approval] = await Promise.all([
  readFixture(values.suite ? resolve(repository, values.suite) : bundledSuite, replaySuiteSchema, "Replay suite"),
  readFixture(securityFixture, promptInjectionSuiteSchema, "Security suite"),
  values.baseline ? readFixture(resolve(repository, values.baseline), evaluationSnapshotSchema, "Baseline report") : null,
  values.approval ? readFixture(resolve(repository, values.approval), replayReviewApprovalSchema, "Replay review receipt") : null
]);
assertReviewedReplayApproved(suite, approval);

let reranker: Reranker | undefined;
let model: string | undefined;
if (values.jina) {
  const { config } = await import("../../config.js");
  if (!config.JINA_API_KEY) throw new Error("Set JINA_API_KEY to run the live Jina benchmark.");
  const { JinaReranker } = await import("../../modules/ai/infrastructure/jina/jina-reranker.js");
  model = config.JINA_RERANKER_MODEL;
  reranker = new JinaReranker("https://api.jina.ai/v1", config.JINA_API_KEY, model);
}

const replay = await evaluateReplay(suite, reranker, values.jina ? AbortSignal.timeout(90_000) : undefined);
const security = evaluatePromptInjectionSuite(securitySuite);
const snapshot: EvaluationSnapshot = {
  schemaVersion: 1,
  replay: { version: suite.version, digest: benchmarkFingerprint(suite), total: suite.cases.length, topK: suite.topK, metrics: replay.baseline },
  security: { version: securitySuite.version, digest: benchmarkFingerprint(securitySuite), total: security.total, screening: security.screening }
};
const comparison = baseline ? compareEvaluationSnapshots(snapshot, baseline) : null;
const report = {
  ...snapshot,
  commitSha: process.env.GITHUB_SHA ?? process.env.RENDER_GIT_COMMIT ?? null,
  passed: security.passed && (comparison?.passed ?? true),
  comparison,
  ...(replay.reranked ? { jina: { model, metrics: replay.reranked } } : {}),
  cases: replay.cases,
  securityFailures: security.failures
};
const json = `${JSON.stringify(report, null, 2)}\n`;
if (values.report) {
  const path = resolve(repository, values.report);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, json, "utf8");
}
process.stdout.write(json);
if (!report.passed) process.exitCode = 1;
