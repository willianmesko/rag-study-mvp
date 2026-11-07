import { createHash } from "node:crypto";
import { McpServer, createMcpHandler, type CallToolResult, type ServerContext } from "@modelcontextprotocol/server";
import { z } from "zod";
import type { FastifyInstance } from "fastify";
import {
  maxMcpReadResponseBytes, mcpReadToolNames, mcpReadToolNameSchema, mcpReadToolDescriptions,
  mcpReadToolInputSchemas, mcpReadToolOutputSchemas, type McpReadToolName
} from "@rag-study/contracts";
import type { McpOAuth } from "../../application/mcp/oauth.js";
import { McpBudgetExceededError, McpIndexUnavailableError } from "../../application/mcp/hybrid-search.js";
import { McpReadToolForbiddenError, type McpReadTools } from "../../application/mcp/read-tools.js";
import type { McpCallControls, McpPrincipal } from "../../application/mcp/remote-types.js";
import type { AuditEventRepository } from "../../application/ports/audit-event-repository.js";
import { withReplySignal } from "../http/reply-signal.js";
import { withExecutionTimeout } from "../../application/policies/agent-execution-policy.js";

export type RemoteMcp = { oauth: McpOAuth; tools: Pick<McpReadTools, "execute">; controls: McpCallControls };
const deadlineMs = 8_000;
const requestIdSchema = z.union([z.string().min(1).max(128), z.number().int().safe()]);
const requestKey = (id: string | number) => createHash("sha256").update(JSON.stringify(id)).digest("hex");
const permittedMethods = new Set(["initialize", "ping", "server/discover", "tools/list", "tools/call", "notifications/initialized", "notifications/cancelled"]);
const failure = (code: string, message: string): CallToolResult => ({ isError: true, content: [{ type: "text", text: `${code}: ${message}` }] });

/** JSON and legacy SSE responses are buffered within a hard bound before returning. */
async function boundedResponse(response: Response): Promise<Buffer> {
  if (!response.body) return Buffer.alloc(0);
  const reader = response.body.getReader();
  const parts: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) return Buffer.concat(parts, size);
      size += value.length;
      if (size > maxMcpReadResponseBytes + 8192) throw new Error("MCP response exceeded its transport bound.");
      parts.push(value);
    }
  } catch (error) { await reader.cancel().catch(() => {}); throw error; }
  finally { reader.releaseLock(); }
}

export function registerRemoteMcp(app: FastifyInstance, dependencies: RemoteMcp & {
  audit: AuditEventRepository["record"]; shutdown: AbortSignal;
}) {
  const { oauth, tools, controls, audit, shutdown } = dependencies;
  app.route({ method: ["GET", "POST", "DELETE"], url: "/mcp", bodyLimit: 8192,
    config: { rateLimit: { max: 120 } }, handler: async (request, reply) => {
      const authorization = request.headers.authorization;
      const token = authorization?.startsWith("Bearer ") ? authorization.slice(7) : "";
      const principal = await oauth.verify(token);
      const challenge = `Bearer resource_metadata="${oauth.issuer}/.well-known/oauth-protected-resource/mcp", scope="workspace:read"`;
      if (!principal) return reply.code(401).header("www-authenticate", challenge).send({ error: "invalid_token" });
      // Workspace is bound to the consent grant. An optional conflicting header
      // must never change that authority, even when the account has many spaces.
      if (request.headers["x-workspace-id"] !== undefined && request.headers["x-workspace-id"] !== principal.tenantId)
        return reply.code(403).send({ error: "workspace_mismatch" });
      if (request.method !== "POST") return reply.code(405).header("allow", "POST").send({ error: "method_not_allowed" });
      const message = z.object({ jsonrpc: z.literal("2.0"), method: z.string().max(80), id: requestIdSchema.optional(), params: z.unknown().optional() }).safeParse(request.body);
      if (!message.success) return reply.code(400).send({ jsonrpc: "2.0", id: null, error: { code: -32600, message: "Invalid MCP request." } });
      const body = message.data;
      const record = (action: "mcp.tool_called" | "mcp.tool_cancelled", tool: string, outcome: string) => audit({
        tenantId: principal.tenantId, actorUserId: principal.userId, action, resourceType: "workspace_mcp", resourceId: principal.grantId,
        requestId: request.id, metadata: { tool, outcome, transport: "http" }
      });
      if (!permittedMethods.has(body.method)) {
        await record("mcp.tool_called", "unknown", "method_forbidden");
        return reply.code(body.id === undefined ? 202 : 400).send(body.id === undefined ? undefined :
          { jsonrpc: "2.0", id: body.id, error: { code: -32601, message: "This MCP method is not enabled." } });
      }
      if (body.method === "notifications/cancelled") {
        const params = z.object({ requestId: requestIdSchema }).safeParse(body.params);
        if (body.id !== undefined || !params.success) return reply.code(400).send({ error: "invalid_cancellation" });
        await controls.cancel(principal, requestKey(params.data.requestId));
        await record("mcp.tool_cancelled", "execution", "cancel_requested");
        return reply.code(202).send();
      }
      return withReplySignal(reply, shutdown, async (connectionSignal) => {
        const deadline = AbortSignal.timeout(deadlineMs);
        const signal = AbortSignal.any([connectionSignal, deadline]);
        if (!await controls.admit(principal.tenantId, principal.userId, signal)) {
          await record("mcp.tool_called", "request", "call_limit_reached");
          return reply.code(429).header("retry-after", "60").send({ error: "mcp_call_limit_reached" });
        }
        const requestedTool = body.method === "tools/call" ? z.object({ name: mcpReadToolNameSchema }).safeParse(body.params) : undefined;
        const permitted = (name: McpReadToolName) => principal.allowedTools.includes(name) && (name !== "get_quality_report" || principal.role === "owner");
        if (body.method === "tools/call" && (!requestedTool?.success || !permitted(requestedTool.data.name) || body.id === undefined)) {
          await record("mcp.tool_called", requestedTool?.success ? requestedTool.data.name : "unknown", "tool_forbidden");
          return reply.code(403).send({ jsonrpc: "2.0", id: body.id ?? null, error: { code: -32602, message: "The connected workspace does not allow this tool." } });
        }
        if (requestedTool?.success) {
          const args = z.object({ arguments: z.unknown().optional() }).parse(body.params).arguments ?? {};
          if (!mcpReadToolInputSchemas[requestedTool.data.name].safeParse(args).success) {
            await record("mcp.tool_called", requestedTool.data.name, "invalid_input");
            return reply.code(400).send({ jsonrpc: "2.0", id: body.id, error: { code: -32602, message: "Invalid workspace tool arguments." } });
          }
        }
        const handler = createMcpHandler(() => {
          const server = new McpServer({ name: "lumora", version: "0.2.0" });
          for (const name of mcpReadToolNames.filter(permitted)) {
            server.registerTool(name, { description: mcpReadToolDescriptions[name], inputSchema: mcpReadToolInputSchemas[name],
              outputSchema: mcpReadToolOutputSchemas[name], annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: name === "search_workspace" }
            }, async (input: unknown, context: ServerContext): Promise<CallToolResult> => {
              try {
                let executionId: string | null = null;
                let timer: ReturnType<typeof setInterval> | undefined;
                let checking = false;
                const cancelled = new AbortController();
                const callSignal = AbortSignal.any([signal, context.mcpReq.signal, cancelled.signal]);
                let outcome = "completed";
                try {
                  executionId = await controls.begin({ principal, requestKey: requestKey(body.id!), tool: name, timeoutMs: deadlineMs });
                  if (!executionId) { outcome = "request_in_progress"; return failure(outcome, "This request is already running."); }
                  if (!await controls.alive(executionId)) { outcome = "access_revoked"; return failure(outcome, "Workspace access is no longer available."); }
                  // The database guard also works when cancellation/revocation
                  // arrives at another API instance. Polling is bounded by deadline.
                  timer = setInterval(() => {
                    if (checking || callSignal.aborted) return;
                    checking = true;
                    void controls.alive(executionId!).then((alive) => { if (!alive) cancelled.abort(); })
                      .catch(() => cancelled.abort()).finally(() => { checking = false; });
                  }, 250);
                  timer.unref();
                  const value = await withExecutionTimeout((boundedSignal) => tools.execute({ tool: name, tenantId: principal.tenantId, userId: principal.userId,
                    role: principal.role, arguments: input, signal: boundedSignal }), deadlineMs, callSignal);
                  callSignal.throwIfAborted();
                  if (!await controls.alive(executionId)) { outcome = "access_revoked"; return failure(outcome, "Workspace access was cancelled or revoked."); }
                  const structuredContent = mcpReadToolOutputSchemas[name].parse(value);
                  const text = JSON.stringify(structuredContent);
                  if (Buffer.byteLength(text) > maxMcpReadResponseBytes) throw new Error("Response exceeded MCP budget.");
                  return { structuredContent, content: [{ type: "text", text }] };
                } catch (error) {
                  outcome = callSignal.aborted ? (deadline.aborted ? "tool_timeout" : "tool_cancelled") : error instanceof McpBudgetExceededError ? "provider_budget_exceeded"
                    : error instanceof McpIndexUnavailableError ? "index_unavailable" : error instanceof z.ZodError ? "invalid_input"
                    : error instanceof McpReadToolForbiddenError ? "tool_forbidden" : "tool_unavailable";
                  return failure(outcome, "The workspace tool could not complete within its permissions and limits.");
                } finally {
                  if (timer) clearInterval(timer);
                  if (executionId) await controls.finish(executionId);
                  await record("mcp.tool_called", name, outcome);
                }
              } catch { return failure("policy_unavailable", "The workspace tool could not verify its execution and audit requirements."); }
            });
          }
          return server;
        }, { legacy: "stateless", maxRequestBodySize: 8192, maxSubscriptions: 0, keepAliveMs: 0 });
        try {
          const headers = new Headers();
          for (const [key, value] of Object.entries(request.headers)) if (typeof value === "string") headers.set(key, value);
          const webRequest = new Request(oauth.resource, { method: "POST", headers, signal });
          const response = await handler.fetch(webRequest, { parsedBody: request.body, authInfo: {
            token, clientId: principal.clientId, scopes: ["workspace:read"], resource: new URL(oauth.resource),
            expiresAt: Math.floor(principal.expiresAt.getTime() / 1000)
          } });
          const payload = await boundedResponse(response);
          signal.throwIfAborted();
          // Never relay authorization, cookies, arbitrary redirects or internal headers.
          for (const name of ["content-type", "mcp-protocol-version", "mcp-session-id"]) {
            const value = response.headers.get(name); if (value) reply.header(name, value);
          }
          return reply.code(response.status).send(payload);
        } catch {
          return reply.code(deadline.aborted ? 504 : connectionSignal.aborted ? 499 : 503).send({ error: "mcp_request_interrupted" });
        } finally { await handler.close(); }
      });
    }
  });
}
