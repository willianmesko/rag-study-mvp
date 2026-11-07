import { setTimeout as delay } from "node:timers/promises";
import { z } from "zod";
import { AgentActionWorker } from "../../modules/mcp/application/agent-actions/agent-action-worker.js";
import { LexicalEvaluationAction } from "../../modules/mcp/application/agent-actions/lexical-evaluation-action.js";
import { PgAgentActionRepository } from "../../modules/mcp/infrastructure/postgres/pg-agent-action-repository.js";
import { PgMcpReadRepository } from "../../modules/mcp/infrastructure/postgres/pg-mcp-read-repository.js";
import { createPostgresPool } from "../../platform/database/pool.js";

async function main() {
  const writeFlag = /(?:^|\s)--allow-fs-write(?:=|\s|$)/;
  if (!process.permission || ["fs.read", "fs.write", "child", "worker", "addons", "wasi", "inspector"].some((scope) => process.permission.has(scope))
    || process.execArgv.some((arg) => writeFlag.test(arg)) || writeFlag.test(process.env.NODE_OPTIONS ?? "")) {
    throw new Error("Use the isolated agent-action worker launcher.");
  }
  const databaseUrl = z.url().parse(process.env.AGENT_ACTIONS_DATABASE_URL);
  const pool = createPostgresPool(databaseUrl, 2);
  const worker = new AgentActionWorker(new PgAgentActionRepository(pool), new LexicalEvaluationAction(new PgMcpReadRepository(pool)));
  const once = process.argv.includes("--once");
  const controller = new AbortController();
  const stop = () => controller.abort();
  process.once("SIGTERM", stop);
  process.once("SIGINT", stop);
  try {
    do {
      try {
        await worker.runNext({ signal: controller.signal });
      } catch {
        if (controller.signal.aborted) break;
        if (once) throw new Error("The action cycle failed.");
        console.error("The approved-action worker could not complete this cycle.");
      }
      if (once) break;
      await delay(1_000, undefined, { signal: controller.signal }).catch(() => undefined);
    } while (!controller.signal.aborted);
  } finally {
    process.off("SIGTERM", stop);
    process.off("SIGINT", stop);
    await pool.end();
  }
}

void main().catch(() => {
  console.error("The approved-action worker could not complete. Check its isolated runtime and database configuration.");
  process.exitCode = 1;
});
