import { McpServer, type CallToolResult, type ServerContext } from "@modelcontextprotocol/server";
import { serveStdio, StdioServerTransport } from "@modelcontextprotocol/server/stdio";
import {
  maxMcpReadResponseBytes, mcpAccessTokenSchema, mcpReadToolDescriptions,
  mcpReadToolInputSchemas, mcpReadToolNames, mcpReadToolOutputSchemas, mcpWorkspaceIdSchema,
  type McpReadToolName
} from "@rag-study/contracts";
import { z } from "zod";

const timeoutMs = 8_000;
const maxConcurrentCalls = 4;
const maxHttpResponseBytes = maxMcpReadResponseBytes + 64;

const configSchema = z.object({
  LUMORA_MCP_API_URL: z.url().transform((value) => new URL(value)).refine((url) =>
    (url.protocol === "https:" || (url.protocol === "http:" && url.hostname === "127.0.0.1")) &&
    !url.username && !url.password && url.pathname === "/" && !url.search && !url.hash
  ),
  LUMORA_MCP_TOKEN: mcpAccessTokenSchema,
  LUMORA_MCP_WORKSPACE_ID: mcpWorkspaceIdSchema
});
type BridgeConfig = z.infer<typeof configSchema>;
const envelopeSchema = z.strictObject({ result: z.unknown() });

function failure(message: string): CallToolResult {
  return { isError: true, content: [{ type: "text", text: message }] };
}

function responseFailure(status: number): CallToolResult {
  switch (status) {
    case 401: return failure("The Lumora MCP credential is invalid or expired.");
    case 403: return failure("The workspace role does not permit this tool.");
    case 404: return failure("This tool or resource is unavailable in the connected workspace.");
    case 429: return failure("The Lumora MCP rate limit was reached.");
    case 504: return failure("The Lumora tool timed out.");
    default: return failure("Lumora could not complete the tool call.");
  }
}

async function readBoundedJson(response: Response): Promise<unknown> {
  const contentType = response.headers.get("content-type")?.split(";")[0]?.trim().toLowerCase();
  if (!response.body || contentType !== "application/json"
    || Number(response.headers.get("content-length")) > maxHttpResponseBytes) {
    void response.body?.cancel().catch(() => {});
    throw new Error("Unexpected Lumora response.");
  }

  const reader = response.body.getReader();
  const bytes = new Uint8Array(maxHttpResponseBytes);
  let size = 0;
  try {
    for (;;) {
      const part = await reader.read();
      if (part.done) break;
      if (size + part.value.byteLength > bytes.byteLength) throw new Error("Response exceeded its budget.");
      bytes.set(part.value, size);
      size += part.value.byteLength;
    }
    return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes.subarray(0, size)));
  } catch (error) {
    void reader.cancel().catch(() => {});
    throw error;
  } finally {
    reader.releaseLock();
  }
}

async function callWorkspaceTool(config: BridgeConfig, name: McpReadToolName, input: unknown, parent: AbortSignal): Promise<CallToolResult> {
  const deadline = AbortSignal.timeout(timeoutMs);
  const signal = AbortSignal.any([parent, deadline]);
  try {
    const url = new URL(`/v1/mcp/tools/${name}`, config.LUMORA_MCP_API_URL);
    const response = await fetch(url, {
      method: "POST",
      headers: {
        authorization: `Bearer ${config.LUMORA_MCP_TOKEN}`,
        "x-workspace-id": config.LUMORA_MCP_WORKSPACE_ID,
        "content-type": "application/json",
        accept: "application/json"
      },
      body: JSON.stringify(input),
      redirect: "error",
      cache: "no-store",
      signal
    });
    if (!response.ok) {
      void response.body?.cancel().catch(() => {});
      return responseFailure(response.status);
    }
    const { result } = envelopeSchema.parse(await readBoundedJson(response));
    const structuredContent = mcpReadToolOutputSchemas[name].parse(result);
    const text = JSON.stringify(structuredContent);
    if (Buffer.byteLength(text) > maxMcpReadResponseBytes) return failure("The Lumora response exceeded its budget.");
    return { structuredContent, content: [{ type: "text", text }] };
  } catch {
    if (parent.aborted) return failure("The Lumora tool call was cancelled.");
    if (deadline.aborted) return failure("The Lumora tool timed out.");
    return failure("The Lumora tool did not return a valid response.");
  }
}

function workspaceServer(config: BridgeConfig): McpServer {
  const server = new McpServer({ name: "lumora", version: "0.1.0" });
  let activeCalls = 0;
  for (const name of mcpReadToolNames) {
    server.registerTool(name, {
      description: mcpReadToolDescriptions[name],
      inputSchema: mcpReadToolInputSchemas[name],
      outputSchema: mcpReadToolOutputSchemas[name],
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false }
    }, async (input: unknown, ctx: ServerContext) => {
      if (activeCalls >= maxConcurrentCalls) return failure("The Lumora MCP concurrency limit was reached.");
      activeCalls++;
      try {
        return await callWorkspaceTool(config, name, input, ctx.mcpReq.signal);
      } finally {
        activeCalls--;
      }
    });
  }
  return server;
}

function main() {
  const permission = process.permission;
  const writeFlag = /(?:^|\s)--allow-fs-write(?:=|\s|$)/;
  if (!permission || ["fs.read", "fs.write", "child", "worker", "addons", "wasi", "inspector"].some((scope) => permission.has(scope))
    || process.execArgv.some((arg) => writeFlag.test(arg)) || writeFlag.test(process.env.NODE_OPTIONS ?? "")) {
    process.stderr.write("Start Lumora MCP with Node's permission model and scoped filesystem reads.\n");
    process.exitCode = 1;
    return;
  }
  const config = configSchema.safeParse(process.env);
  if (!config.success) {
    const fields = config.error.issues.map((issue) => issue.path.join(".")).join(", ");
    process.stderr.write(`Invalid Lumora MCP configuration: ${fields}.\n`);
    process.exitCode = 1;
    return;
  }
  const transport = new StdioServerTransport(process.stdin, process.stdout, { maxBufferSize: 16_384 });
  serveStdio(() => workspaceServer(config.data), { transport });
}

main();
