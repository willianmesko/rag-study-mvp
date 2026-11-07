import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { join } from "node:path";
import { test, type TestContext } from "node:test";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/client";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";
import { maxMcpReadResponseBytes, mcpReadToolNames } from "@rag-study/contracts";

const root = fileURLToPath(new URL("../../../../../", import.meta.url));
const workspaceId = "11111111-1111-4111-8111-111111111111";
const token = "lumora_mcp_AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";
const options = { timeout: 15_000, skip: Number(process.versions.node.split(".")[0]) < 24 && "The MCP runtime requires Node 24." };

type Call = { path: string; method?: string; authorization?: string; workspace?: string; input: unknown };

async function startFixture(t: TestContext, handle: (call: Call, response: ServerResponse) => void, mode: "legacy" | "auto" = "legacy") {
  const calls: Call[] = [];
  const api = createServer((request, response) => {
    void readCall(request).then((call) => {
      calls.push(call);
      handle(call, response);
    }).catch(() => response.destroy());
  });
  t.after(() => {
    api.closeAllConnections();
    return new Promise<void>((resolve) => api.close(() => resolve()));
  });
  await new Promise<void>((resolve) => api.listen(0, "127.0.0.1", resolve));
  const address = api.address();
  assert(address && typeof address !== "string");

  const allowedReads = [
    "node_modules", "apps/api/package.json", "apps/api/src/interfaces/mcp",
    "packages/contracts/package.json", "packages/contracts/dist"
  ];
  const client = new Client({ name: "lumora-mcp-fixture", version: "1.0.0" }, { versionNegotiation: { mode } });
  t.after(() => client.close());
  await client.connect(new StdioClientTransport({
    command: process.execPath,
    args: [
      "--permission", ...allowedReads.map((path) => `--allow-fs-read=${join(root, path)}`),
      join(root, "apps/api/src/interfaces/mcp/stdio.ts")
    ],
    env: {
      LUMORA_MCP_API_URL: `http://127.0.0.1:${address.port}`,
      LUMORA_MCP_TOKEN: token,
      LUMORA_MCP_WORKSPACE_ID: workspaceId
    }
  }));
  return { client, calls };
}

async function readCall(request: IncomingMessage): Promise<Call> {
  const body: Buffer[] = [];
  for await (const chunk of request) body.push(chunk);
  return {
    path: request.url ?? "", method: request.method, authorization: request.headers.authorization,
    workspace: request.headers["x-workspace-id"] as string | undefined,
    input: JSON.parse(Buffer.concat(body).toString("utf8")) as unknown
  };
}

function json(response: ServerResponse, status: number, value: unknown) {
  response.writeHead(status, { "content-type": "application/json" });
  response.end(JSON.stringify(value));
}

test("stdio exposes only the five read tools and pins calls to the configured workspace", options, async (t) => {
  const { client, calls } = await startFixture(t, (_call, response) => json(response, 200, { result: { sources: [] } }));
  const { tools } = await client.listTools();
  assert.deepEqual(tools.map((tool) => tool.name).sort(), [...mcpReadToolNames].sort());
  assert(tools.every((tool) => tool.annotations?.readOnlyHint === true && tool.inputSchema.additionalProperties === false));

  const result = await client.callTool({ name: "list_sources", arguments: { limit: 3 } });
  assert.deepEqual(result.structuredContent, { sources: [] });
  assert.deepEqual(calls, [{
    path: "/v1/mcp/tools/list_sources", method: "POST", authorization: `Bearer ${token}`,
    workspace: workspaceId, input: { limit: 3 }
  }]);

  const invalid = await client.callTool({ name: "list_sources", arguments: { workspaceId } });
  assert.equal(invalid.isError, true);
  await assert.rejects(client.callTool({ name: "run_evaluation", arguments: {} }));
  assert.equal(calls.length, 1);
});

test("stdio rejects redirects, oversized and unexpected output, and masks upstream error bodies", options, async (t) => {
  const { client, calls } = await startFixture(t, ({ input }, response) => {
    switch ((input as { limit: number }).limit) {
      case 1:
        response.writeHead(302, { location: "/unexpected" });
        response.end();
        break;
      case 2:
        response.writeHead(200, { "content-type": "application/json" });
        response.write('{"result":{"sources":[],"secret":"');
        response.end("x".repeat(maxMcpReadResponseBytes) + '"}}');
        break;
      case 3:
        json(response, 200, { result: { sources: [], secret: token } });
        break;
      default:
        json(response, 403, { error: token });
    }
  }, "auto");
  for (const limit of [1, 2, 3, 4]) {
    const result = await client.callTool({ name: "list_sources", arguments: { limit } });
    assert.equal(result.isError, true);
    assert(!JSON.stringify(result).includes(token));
  }
  assert.deepEqual(calls.map(({ path }) => path), Array<string>(4).fill("/v1/mcp/tools/list_sources"));
});

test("stdio cancels the in-flight HTTP request when the MCP client cancels", options, async (t) => {
  let markStarted: () => void;
  let markClosed: () => void;
  const started = new Promise<void>((resolve) => { markStarted = resolve; });
  const closed = new Promise<void>((resolve) => { markClosed = resolve; });
  const { client } = await startFixture(t, (_call, response) => {
    response.once("close", markClosed);
    markStarted();
  });

  const controller = new AbortController();
  const cancelled = assert.rejects(client.callTool({
    name: "search_workspace", arguments: { query: "client test" }
  }, { signal: controller.signal }));
  await started;
  controller.abort();
  await cancelled;
  await closed;
});

test("stdio bounds simultaneous tool calls before opening more HTTP work", options, async (t) => {
  let markStarted: () => void;
  const started = new Promise<void>((resolve) => { markStarted = resolve; });
  const pending: ServerResponse[] = [];
  const { client, calls } = await startFixture(t, (_call, response) => {
    pending.push(response);
    if (pending.length === 4) markStarted();
  });
  const admitted = Array.from({ length: 4 }, () => client.callTool({ name: "list_sources", arguments: {} }));
  await started;
  const rejected = await client.callTool({ name: "list_sources", arguments: {} });
  assert.equal(rejected.isError, true);
  assert.equal(calls.length, 4);
  for (const response of pending) json(response, 200, { result: { sources: [] } });
  await Promise.all(admitted);
});

test("stdio cancels in-flight work when its host disconnects", options, async (t) => {
  let markStarted: () => void;
  let markClosed: () => void;
  const started = new Promise<void>((resolve) => { markStarted = resolve; });
  const closed = new Promise<void>((resolve) => { markClosed = resolve; });
  const { client } = await startFixture(t, (_call, response) => {
    response.once("close", markClosed);
    markStarted();
  });
  const pending = client.callTool({ name: "list_sources", arguments: {} }).catch(() => undefined);
  await started;
  await client.close();
  await closed;
  await pending;
});

test("stdio refuses to start outside its restricted Node runtime", options, async () => {
  const child = spawn(process.execPath, [join(root, "apps/api/src/interfaces/mcp/stdio.ts")], {
    stdio: ["ignore", "pipe", "pipe"],
    env: {
      LUMORA_MCP_API_URL: "http://127.0.0.1:3000",
      LUMORA_MCP_TOKEN: token, LUMORA_MCP_WORKSPACE_ID: workspaceId
    }
  });
  let stdout = "";
  let stderr = "";
  child.stdout.setEncoding("utf8").on("data", (text) => { stdout += text; });
  child.stderr.setEncoding("utf8").on("data", (text) => { stderr += text; });
  const [code] = await once(child, "exit");
  assert.equal(code, 1);
  assert.equal(stdout, "");
  assert.match(stderr, /permission model/);
  assert(!stderr.includes(token));
});
