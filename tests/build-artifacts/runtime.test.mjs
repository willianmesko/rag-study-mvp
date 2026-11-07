import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, mkdir, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { inspectRuntimeArtifacts, requireNativeOcrSuccess, runtimeEntries } from "../../scripts/runtime-artifacts.mjs";

async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), "lumora-runtime-artifacts-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  for (const name of runtimeEntries) { await mkdir(dirname(join(root, name)), { recursive: true }); await writeFile(join(root, name), "export {};\n"); }
  return root;
}
test("runtime inventory requires every supported entry and rejects test files and test imports", async (t) => {
  const root = await fixture(t);
  assert.equal((await inspectRuntimeArtifacts(root)).entries, runtimeEntries.length);
  for (const name of ["example.test.js", "example.test.js.map", "example.spec.js", "pdf-test-fixture.js"]) {
    await writeFile(join(root, name), "synthetic"); await assert.rejects(inspectRuntimeArtifacts(root), /Test-only/); await rm(join(root, name));
  }
  await writeFile(join(root, "bad.js"), 'import test from "node:test";'); await assert.rejects(inspectRuntimeArtifacts(root), /test runner/);
  await rm(join(root, "bad.js")); await rm(join(root, "server.js")); await assert.rejects(inspectRuntimeArtifacts(root), /entry is missing/);
});
test("runtime inventory refuses symlinks rather than following them outside the artifact tree", async (t) => {
  const root = await fixture(t); await symlink("/tmp", join(root, "outside"));
  await assert.rejects(inspectRuntimeArtifacts(root), /symbolic links/);
});
test("native OCR release receipt requires two real passes and no skips, timeout or process failure", () => {
  const valid = { status: 0, signal: null, stdout: "# tests 2\n# pass 2\n# skipped 0\n" };
  assert.doesNotThrow(() => requireNativeOcrSuccess(valid));
  for (const patch of [{ status: 1 }, { signal: "SIGTERM" }, { error: new Error("timeout") }, { stdout: "# tests 2\n# pass 0\n# skipped 2\n" }, { stdout: "# tests 1\n# pass 1\n# skipped 0\n" }, { stdout: "" }])
    assert.throws(() => requireNativeOcrSuccess({ ...valid, ...patch }), /Both native OCR/);
});
