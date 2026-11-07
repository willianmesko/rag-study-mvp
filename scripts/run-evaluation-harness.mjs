import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { spawn } from "node:child_process";
import { performance } from "node:perf_hooks";

const root = resolve(import.meta.dirname, "..");
const args = process.argv.slice(2);
const reportFlagIndex = args.indexOf("--report");
const reportPath = reportFlagIndex >= 0 && args[reportFlagIndex + 1]
  ? resolve(root, args[reportFlagIndex + 1])
  : null;
const skipPromptfoo = args.includes("--skip-promptfoo");

const checks = [
  { id: "typecheck", command: "npm run typecheck" },
  { id: "unit-tests", command: "npm test" },
  { id: "production-build", command: "npm run build" },
  { id: "prompt-injection", command: "npm run eval:security -- evals/security/prompt-injection.v1.json" },
  { id: "golden-set", command: "npm run eval:golden:ci" },
  { id: "replay-regression", command: "npm run eval:regression" },
  { id: "promptfoo", command: "npm run eval:promptfoo" }
];
const selectedChecks = skipPromptfoo ? checks.filter((check) => check.id !== "promptfoo") : checks;

function run(command) {
  return new Promise((resolveResult) => {
    const startedAt = performance.now();
    const child = spawn(command, { cwd: root, shell: true, env: process.env, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => { stdout += chunk.toString(); });
    child.stderr.on("data", (chunk) => { stderr += chunk.toString(); });
    child.on("close", (exitCode, signal) => resolveResult({
      passed: exitCode === 0,
      exitCode,
      signal,
      durationMs: Math.round(performance.now() - startedAt),
      stdout,
      stderr
    }));
  });
}

function parseJsonReport(output) {
  const lines = output.trim().split("\n");
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    const candidate = lines.slice(index).join("\n").trim();
    try {
      const parsed = JSON.parse(candidate);
      if (parsed && typeof parsed === "object") return parsed;
    } catch {
      // Commands such as npm print logs before their final JSON report.
    }
  }
  return null;
}

function summarize(id, result) {
  const parsed = ["golden-set", "prompt-injection", "replay-regression"].includes(id) ? parseJsonReport(result.stdout) : null;
  return {
    id,
    passed: result.passed,
    exitCode: result.exitCode,
    durationMs: result.durationMs,
    ...(id === "golden-set" && parsed ? {
      total: parsed.total,
      hitRate: parsed.hitRate,
      meanReciprocalRank: parsed.meanReciprocalRank,
      qualityGatePassed: parsed.passed
    } : {}),
    ...(id === "prompt-injection" && parsed ? {
      total: parsed.total,
      failureCount: parsed.failures?.length ?? null,
      qualityGatePassed: parsed.passed
    } : {}),
    ...(id === "replay-regression" && parsed ? {
      replay: parsed.replay,
      screening: parsed.security?.screening,
      comparison: parsed.comparison
    } : {})
  };
}

const startedAt = new Date().toISOString();
const results = [];
for (const check of selectedChecks) {
  process.stdout.write(`\n[harness] ${check.id}: ${check.command}\n`);
  const result = await run(check.command);
  const summary = summarize(check.id, result);
  results.push(summary);
  process.stdout.write(`[harness] ${check.id}: ${summary.passed ? "passed" : "failed"} (${summary.durationMs} ms)\n`);
  if (!summary.passed) {
    process.stderr.write(result.stderr.slice(-4_000));
    break;
  }
}

const report = {
  harness: "lumora-quality-harness",
  version: 1,
  startedAt,
  finishedAt: new Date().toISOString(),
  commitSha: process.env.GITHUB_SHA ?? process.env.RENDER_GIT_COMMIT ?? null,
  skippedChecks: skipPromptfoo ? ["promptfoo"] : [],
  passed: results.length === selectedChecks.length && results.every((result) => result.passed),
  checks: results
};

process.stdout.write(`\n${JSON.stringify(report, null, 2)}\n`);
if (reportPath) {
  await mkdir(resolve(reportPath, ".."), { recursive: true });
  await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  process.stdout.write(`[harness] report written to ${reportPath}\n`);
}

if (!report.passed) process.exitCode = 1;
