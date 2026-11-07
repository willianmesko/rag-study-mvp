import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, mkdir, writeFile, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { inspectFrontendBuild, checkFrontendBudget } from "../../scripts/frontend-performance.mjs";

const names = ["entryGzipBytes", "totalJavaScriptGzipBytes", "totalCssGzipBytes", "largestJavaScriptGzipBytes"];
const metrics = Object.fromEntries(names.map((name) => [name, 1000]));
function policy() { return { version: 1, baseline: { source: "a".repeat(40), metrics },
  limits: Object.fromEntries(names.map((name) => [name, { relativeGrowth: 0.05, absoluteGrowthBytes: 20 }])), exceptions: [] }; }

test("build inspection measures actual entry and lazy assets with reproducible gzip sizes", async () => {
  const dir = await mkdtemp(join(tmpdir(), "lumora-budget-"));
  try {
    await mkdir(join(dir, "assets")); await writeFile(join(dir, "index.html"), '<script type="module" src="/assets/main-hash.js"></script>');
    await writeFile(join(dir, "assets/main-hash.js"), 'console.log("Entry");');
    await writeFile(join(dir, "assets/lazy-hash.js"), 'console.log("Lazy");');
    await writeFile(join(dir, "assets/style.css"), 'body{color:white}');
    const result = await inspectFrontendBuild(dir);
    assert.equal(result.entry, "assets/main-hash.js"); assert.equal(result.metrics.javascriptChunks, 2);
    assert.ok(result.metrics.entryGzipBytes > 0); assert.ok(result.metrics.totalJavaScriptGzipBytes > result.metrics.entryGzipBytes);
    assert.deepEqual(await inspectFrontendBuild(dir), result);
    await writeFile(join(dir, "index.html"), '<script src="https://outside.invalid/main.js"></script>');
    await assert.rejects(inspectFrontendBuild(dir), /local, bounded/);
    await writeFile(join(dir, "index.html"), '<script src="/assets/../../main.js"></script>');
    await assert.rejects(inspectFrontendBuild(dir), /local, bounded/);
    await writeFile(join(dir, "index.html"), '<script src="/assets/main-hash.js"></script>');
    await symlink(join(dir, "assets/main-hash.js"), join(dir, "assets/link.js"));
    await assert.rejects(inspectFrontendBuild(dir), /symlinks/);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test("payload regressions fail by metric rather than by hashed chunk name", () => {
  assert.equal(checkFrontendBudget(metrics, policy()).passed, true);
  const candidate = { ...metrics, entryGzipBytes: 1100, totalJavaScriptGzipBytes: 1300 };
  const result = checkFrontendBudget(candidate, policy());
  assert.equal(result.passed, false);
  assert.deepEqual(result.failures.map((item) => item.metric), ["entryGzipBytes", "totalJavaScriptGzipBytes"]);
  for (const bad of [NaN, -1, Infinity, 1.5]) assert.throws(() => checkFrontendBudget({ ...metrics, entryGzipBytes: bad }, policy()), /finite baseline/);
});

test("exceptions are explicit, bounded to known metrics, recorded and expire", () => {
  const reviewed = policy();
  reviewed.exceptions.push({ id: "TEST-001", reason: "Synthetic fixture for a reviewed payload increase.", reviewedBy: "fixture reviewer", expiresAt: "2026-11-10T00:00:00Z", ceilings: { entryGzipBytes: 1200 } });
  const now = new Date("2026-11-07T00:00:00Z");
  assert.equal(checkFrontendBudget({ ...metrics, entryGzipBytes: 1100 }, reviewed, now).passed, true);
  assert.equal(checkFrontendBudget(metrics, reviewed, now).exceptionsUsed[0].id, "TEST-001");
  assert.throws(() => checkFrontendBudget(metrics, reviewed, new Date("2026-11-11T00:00:00Z")), /unexpired/);
  reviewed.exceptions[0].ceilings = { unmeasuredMetric: 2000 };
  assert.throws(() => checkFrontendBudget(metrics, reviewed, now), /known measured ceiling/);
  reviewed.exceptions[0].ceilings = { entryGzipBytes: 1200 }; reviewed.exceptions.push({ ...reviewed.exceptions[0] });
  assert.throws(() => checkFrontendBudget(metrics, reviewed, now), /unique ID/);
});
