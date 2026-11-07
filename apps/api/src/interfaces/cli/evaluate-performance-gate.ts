import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import type { ZodType } from "zod";
import { comparePerformanceRuns, performanceRunsSchema, performanceThresholdsSchema } from "../../application/evaluation/performance-gate.js";

const root = fileURLToPath(new URL("../../../../../", import.meta.url));
const { values } = parseArgs({ options: { baseline: { type: "string" }, candidate: { type: "string" }, limits: { type: "string" } } });
const baseline = values.baseline ?? process.env.EVAL_PERFORMANCE_BASELINE;
const candidate = values.candidate ?? process.env.EVAL_PERFORMANCE_CANDIDATE;
const limits = values.limits ?? process.env.EVAL_PERFORMANCE_LIMITS;

async function load<T>(path: string, schema: ZodType<T>, name: string): Promise<T> {
  const file = await readFile(resolve(root, path), "utf8");
  let content: unknown;
  try { content = JSON.parse(file); } catch { throw new Error(`The ${name} file is not valid JSON.`); }
  const parsed = schema.safeParse(content);
  if (!parsed.success) throw new Error(`The ${name} file is not a valid completed public evaluation export or limits file.`);
  return parsed.data;
}

if (!baseline || !candidate || !limits) throw new Error("Provide --baseline, --candidate, and --limits for the performance gate.");
const [before, after, thresholds] = await Promise.all([
  load(baseline, performanceRunsSchema, "baseline"), load(candidate, performanceRunsSchema, "candidate"),
  load(limits, performanceThresholdsSchema, "limits")
]);
const report = comparePerformanceRuns(before, after, thresholds);
console.log(JSON.stringify(report, null, 2));
if (!report.passed) process.exitCode = 1;
