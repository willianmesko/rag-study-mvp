import type { FastifyReply } from "fastify";

export async function withReplySignal<T>(reply: FastifyReply, shutdown: AbortSignal, task: (signal: AbortSignal) => Promise<T>): Promise<T> {
  const controller = new AbortController();
  const disconnect = () => controller.abort();
  if (reply.raw.destroyed) disconnect();
  reply.raw.once("close", disconnect);
  try {
    return await task(AbortSignal.any([controller.signal, shutdown]));
  } finally {
    reply.raw.off("close", disconnect);
  }
}
