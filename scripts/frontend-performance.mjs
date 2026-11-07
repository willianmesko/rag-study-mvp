import { readFile, readdir, lstat, mkdir, writeFile } from "node:fs/promises";
import { gzipSync } from "node:zlib";
import { resolve, relative, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";

export const root = fileURLToPath(new URL("../", import.meta.url));
const metricNames = ["entryGzipBytes", "totalJavaScriptGzipBytes", "totalCssGzipBytes", "largestJavaScriptGzipBytes"];

export async function inspectFrontendBuild(dist = resolve(root, "apps/web/dist")) {
  let html;
  try { html = await readFile(resolve(dist, "index.html"), "utf8"); }
  catch { throw new Error("Build output is missing. Run npm run build:web first."); }
  const src = html.match(/<script\b[^>]*\bsrc="([^"]+\.js)"/)?.[1];
  if (!src || !/^\/?assets\/[A-Za-z0-9_./-]+\.js$/.test(src) || src.includes(".."))
    throw new Error("The build must have a local, bounded JavaScript entry.");
  const entry = src.replace(/^\//, "");
  const paths = [];
  async function walk(directory) {
    if ((await lstat(directory)).isSymbolicLink()) throw new Error("Build inspection does not follow symlinks.");
    for (const name of (await readdir(directory)).sort()) {
      const file = resolve(directory, name), metadata = await lstat(file);
      if (metadata.isSymbolicLink()) throw new Error("Build inspection does not follow symlinks.");
      if (metadata.isDirectory()) await walk(file);
      else if (metadata.isFile() && /\.(js|css)$/.test(name)) paths.push(file);
    }
  }
  await walk(resolve(dist, "assets"));
  const assets = await Promise.all(paths.map(async (path) => {
    const bytes = await readFile(path);
    return { file: relative(dist, path).replaceAll("\\", "/"), rawBytes: bytes.length, gzipBytes: gzipSync(bytes, { level: 9 }).length };
  }));
  const js = assets.filter((asset) => asset.file.endsWith(".js")), css = assets.filter((asset) => asset.file.endsWith(".css"));
  const initial = js.find((asset) => asset.file === entry);
  if (!initial || !css.length) throw new Error("The build entry and stylesheet must be present.");
  const sum = (items, field) => items.reduce((total, item) => total + item[field], 0);
  return { entry, assets, metrics: { entryRawBytes: initial.rawBytes, entryGzipBytes: initial.gzipBytes,
    totalJavaScriptRawBytes: sum(js, "rawBytes"), totalJavaScriptGzipBytes: sum(js, "gzipBytes"),
    totalCssGzipBytes: sum(css, "gzipBytes"), largestJavaScriptGzipBytes: Math.max(...js.map((asset) => asset.gzipBytes)),
    javascriptChunks: js.length, cssChunks: css.length } };
}

export function checkFrontendBudget(metrics, policy, now = new Date()) {
  if (policy.version !== 1 || !/^[a-f0-9]{40}$/.test(policy.baseline?.source ?? "") || !Array.isArray(policy.exceptions))
    throw new Error("Invalid frontend budget policy.");
  const ceilings = {}, exceptionsUsed = [], failures = [];
  for (const metric of metricNames) {
    const baseline = policy.baseline.metrics?.[metric], rule = policy.limits?.[metric], value = metrics[metric];
    if (!Number.isSafeInteger(baseline) || baseline <= 0 || !Number.isSafeInteger(value) || value < 0 ||
      !Number.isFinite(rule?.relativeGrowth) || rule.relativeGrowth < 0 || rule.relativeGrowth > 1 ||
      !Number.isSafeInteger(rule?.absoluteGrowthBytes) || rule.absoluteGrowthBytes < 0)
      throw new Error("Every frontend metric needs a finite baseline, measurement and growth rule.");
    ceilings[metric] = Math.floor(Math.max(baseline * (1 + rule.relativeGrowth), baseline + rule.absoluteGrowthBytes));
  }
  const seen = new Set();
  for (const exception of policy.exceptions) {
    if (typeof exception.id !== "string" || seen.has(exception.id) || !exception.id.trim() ||
      typeof exception.reason !== "string" || exception.reason.trim().length < 20 ||
      typeof exception.reviewedBy !== "string" || !exception.reviewedBy.trim() ||
      !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/.test(exception.expiresAt ?? "") ||
      !Number.isFinite(Date.parse(exception.expiresAt)) || Date.parse(exception.expiresAt) <= now.getTime() ||
      new Date(exception.expiresAt).toISOString().replace(".000Z", "Z") !== exception.expiresAt ||
      !exception.ceilings || !Object.keys(exception.ceilings).length)
      throw new Error("A budget exception needs a unique ID, rationale, recorded reviewer and unexpired deadline.");
    seen.add(exception.id);
    for (const [metric, ceiling] of Object.entries(exception.ceilings)) {
      if (!metricNames.includes(metric) || !Number.isSafeInteger(ceiling) || ceiling < ceilings[metric])
        throw new Error("A budget exception may only raise a known measured ceiling.");
      ceilings[metric] = ceiling;
    }
    exceptionsUsed.push({ id: exception.id, reason: exception.reason, reviewedBy: exception.reviewedBy, expiresAt: exception.expiresAt });
  }
  for (const metric of metricNames) if (metrics[metric] > ceilings[metric])
    failures.push({ metric, measured: metrics[metric], ceiling: ceilings[metric] });
  return { passed: failures.length === 0, baselineSource: policy.baseline.source, ceilings, failures, exceptionsUsed };
}

function sourceCommit() {
  const value = process.env.GITHUB_SHA ?? process.env.RENDER_GIT_COMMIT;
  if (value && /^[a-f0-9]{40}$/.test(value)) return value;
  try { return execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim(); }
  catch { return null; }
}

export async function main(args = process.argv.slice(2)) {
  const allowed = new Set(["--report", "--budget"]), options = {};
  for (let i = 0; i < args.length; i += 2) {
    if (!allowed.has(args[i]) || !args[i + 1] || args[i + 1].startsWith("--") || options[args[i]]) throw new Error("Use --report path and/or --budget path.");
    options[args[i]] = args[i + 1];
  }
  const policy = JSON.parse(await readFile(resolve(root, options["--budget"] ?? "config/frontend-performance-budget.json"), "utf8"));
  const build = await inspectFrontendBuild(), budget = checkFrontendBudget(build.metrics, policy);
  const vite = JSON.parse(await readFile(resolve(root, "node_modules/vite/package.json"), "utf8"));
  let worktreeDirty = null;
  try { worktreeDirty = execFileSync("git", ["status", "--porcelain"], { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim().length > 0; } catch { /* Archives have no Git working tree. */ }
  const report = { version: 1, worktreeDirty, kind: "lumora.frontend-build", generatedAt: new Date().toISOString(), source: sourceCommit(),
    environment: { node: process.version, platform: process.platform, arch: process.arch, vite: vite.version, gzipLevel: 9,
      scope: "Local build artifacts; not network transfer, field LCP or a speedup measurement." }, build, budget, passed: budget.passed };
  if (options["--report"]) {
    const file = resolve(root, options["--report"]); await mkdir(dirname(file), { recursive: true }); await writeFile(file, JSON.stringify(report, null, 2) + "\n");
  }
  process.stdout.write(JSON.stringify(report, null, 2) + "\n");
  if (!report.passed) process.exitCode = 1;
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url))
  await main().catch((error) => { process.stderr.write(`Frontend budget failed: ${error.message}\n`); process.exitCode = 1; });
