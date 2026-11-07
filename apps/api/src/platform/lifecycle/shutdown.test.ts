import assert from "node:assert/strict";
import test from "node:test";
import { spawn } from "node:child_process";
import { createShutdownCoordinator } from "./shutdown.js";

test("repeated shutdown requests share one drain, abort work and clean every owned resource once", async () => {
  const calls: string[] = [];
  const events: unknown[] = [];
  const lifecycle = createShutdownCoordinator({
    timeoutMs: 100,
    stopBackground: () => { calls.push("background"); },
    closeHttp: async () => { calls.push("http"); },
    drain: async () => { assert.ok(lifecycle.signal.aborted); calls.push("drain"); },
    closeResources: async () => { calls.push("resources"); },
    flushTelemetry: async () => { calls.push("telemetry"); },
    report: (event) => events.push(event),
  });
  const first = lifecycle.shutdown("SIGTERM");
  assert.equal(lifecycle.shutdown("SIGINT"), first);
  assert.deepEqual(await first, { code: 0, outcome: "completed", failedStages: [] });
  assert.deepEqual(calls, ["background", "http", "drain", "resources", "telemetry"]);
  assert.equal(events.length, 2);
});

test("cleanup still runs when drain ignores cancellation and no raw failures enter diagnostics", async () => {
  const calls: string[] = [], events: unknown[] = [];
  const lifecycle = createShutdownCoordinator({ timeoutMs: 60,
    stopBackground: () => { calls.push("background"); },
    closeHttp: async () => { throw new Error("PRIVATE_SENTINEL"); },
    drain: () => new Promise(() => {}),
    closeResources: async () => { calls.push("resources"); },
    flushTelemetry: async () => { calls.push("telemetry"); },
    report: (event) => events.push(event),
  });
  const result = await lifecycle.shutdown("SIGTERM");
  assert.equal(result.outcome, "timeout");
  assert.equal(result.code, 1);
  assert.deepEqual(result.failedStages, ["http"]);
  assert.deepEqual(calls, ["background", "resources", "telemetry"]);
  assert.ok(!JSON.stringify(events).includes("PRIVATE_SENTINEL"));
});

test("resource or telemetry failure does not prevent other cleanup and startup failure remains failed", async () => {
  for (const reason of ["SIGTERM", "startup_failure"] as const) {
    let flushed = false;
    const lifecycle = createShutdownCoordinator({ timeoutMs: 100,
      stopBackground: () => {}, closeHttp: async () => {}, drain: async () => {},
      closeResources: async () => { throw new Error("private error"); },
      flushTelemetry: async () => { flushed = true; },
    });
    assert.equal((await lifecycle.shutdown(reason)).code, 1);
    assert.equal(flushed, true);
  }
});

test("the executable can exit within budget when a provider refuses to settle, even after repeated SIGTERM", async (t) => {
  const moduleUrl = new URL("./shutdown.ts", import.meta.url).href;
  const script = `import {createShutdownCoordinator} from ${JSON.stringify(moduleUrl)};
    let requests=0; const lifecycle=createShutdownCoordinator({timeoutMs:120,
      stopBackground:()=>{},closeHttp:async()=>{},drain:()=>new Promise(()=>{}),
      closeResources:async()=>process.stdout.write('resources\\n'),flushTelemetry:async()=>process.stdout.write('telemetry\\n')});
    process.on('SIGTERM',()=>{requests++;void lifecycle.shutdown('SIGTERM').then(result=>{process.stdout.write('result:'+JSON.stringify({...result,requests})+'\\n');process.exit(result.code);});});
    setInterval(()=>{},1000);process.stdout.write('ready\\n');`;
  const child = spawn(process.execPath, ["--import", "tsx", "--input-type=module", "-e", script], { stdio: ["ignore", "pipe", "pipe"] });
  t.after(() => { if (child.exitCode === null) child.kill("SIGKILL"); });
  let output = "", stderr = "";
  child.stderr.on("data", (chunk) => { stderr += String(chunk); });
  const exited = new Promise<number | null>((resolve, reject) => { child.once("error", reject); child.once("exit", (code) => resolve(code)); });
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("Shutdown fixture did not start: " + stderr)), 5_000);
    child.stdout.on("data", (chunk) => { output += String(chunk); if (output.includes("ready\n")) { clearTimeout(timer); resolve(); } });
  });
  child.kill("SIGTERM");
  child.kill("SIGTERM");
  const deadline = new Promise<never>((_resolve, reject) => { const timer = setTimeout(() => reject(new Error("Shutdown exceeded its budget.")), 3_000); timer.unref(); });
  assert.equal(await Promise.race([exited, deadline]), 1);
  assert.equal((output.match(/resources\n/g) ?? []).length, 1);
  assert.equal((output.match(/telemetry\n/g) ?? []).length, 1);
  assert.match(output, /"outcome":"timeout"/);
});
