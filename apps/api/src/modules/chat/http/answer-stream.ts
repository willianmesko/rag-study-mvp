import { once } from "node:events";
import { setTimeout as delay } from "node:timers/promises";
import type { FastifyReply, FastifyRequest } from "fastify";
import type { ChatRunRepository, ChatRunScope } from "../application/ports/chat-run-repository.js";

export function openAnswerStream(request: FastifyRequest, reply: FastifyReply, serverSignal: AbortSignal) {
  const response = reply.raw;
  const client = new AbortController();
  const disconnect = () => client.abort();
  response.once("close", disconnect);
  const signal = AbortSignal.any([client.signal, serverSignal]);
  if (response.destroyed) disconnect();
  const origin = reply.getHeader("access-control-allow-origin");
  reply.hijack();
  if (!signal.aborted) {
    response.writeHead(200, {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-store, no-transform",
      "x-accel-buffering": "no",
      "x-content-type-options": "nosniff",
      "x-frame-options": "DENY",
      "referrer-policy": "no-referrer",
      "x-request-id": request.id,
      ...(typeof origin === "string" ? { "access-control-allow-origin": origin, vary: "Origin" } : {})
    });
    response.flushHeaders();
  }

  async function write(frame: string) {
    signal.throwIfAborted();
    if (!response.write(frame)) await once(response, "drain", { signal });
  }

  return {
    signal,
    event: (name: string, data: unknown, id?: number) =>
      write(`${id === undefined ? "" : `id: ${id}\n`}event: ${name}\ndata: ${JSON.stringify(data)}\n\n`),
    heartbeat: () => write(": keep-alive\n\n"),
    close() {
      response.off("close", disconnect);
      if (signal.aborted && response.writableNeedDrain) response.destroy();
      else if (!response.destroyed) response.end();
    }
  };
}

export async function replayAnswerStream(
  request: FastifyRequest,
  reply: FastifyReply,
  repository: ChatRunRepository,
  scope: ChatRunScope,
  cursor: number,
  shutdown: AbortSignal
) {
  let snapshot = await repository.read(scope, cursor);
  if (!snapshot) return reply.code(404).send({ error: "This answer session is no longer available." });

  const stream = openAnswerStream(request, reply, AbortSignal.any([shutdown, AbortSignal.timeout(45_000)]));
  let lastWrite = Date.now();
  try {
    while (snapshot && !stream.signal.aborted) {
      for (const { id, event } of snapshot.events) {
        await stream.event(event.type, event, id);
        cursor = id;
        lastWrite = Date.now();
        if (event.type === "completed" || event.type === "error" || event.type === "cancelled") return;
      }
      if (snapshot.events.length === 0) {
        if (snapshot.status !== "running") return;
        if (Date.now() - lastWrite >= 10_000) {
          await stream.heartbeat();
          lastWrite = Date.now();
        }
        await delay(500, undefined, { signal: stream.signal });
      }
      snapshot = await repository.read(scope, cursor);
    }
  } catch (error) {
    if (!stream.signal.aborted) request.log.warn({ err: error, runId: scope.runId }, "Answer stream delivery interrupted");
  } finally {
    stream.close();
  }
}
