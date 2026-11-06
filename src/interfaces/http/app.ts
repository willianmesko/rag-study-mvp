import { timingSafeEqual } from "node:crypto";
import rateLimit from "@fastify/rate-limit";
import Fastify from "fastify";
import { ZodError, z } from "zod";
import type { AnswerQuestionUseCase } from "../../application/use-cases/answer-question.js";
import type { IngestDocumentUseCase } from "../../application/use-cases/ingest-document.js";
import type { SearchDocumentsUseCase } from "../../application/use-cases/search-documents.js";
import { config } from "../../config.js";

const documentSchema = z.object({
  source: z.string().min(1).max(1_000),
  title: z.string().min(1).max(500).optional(),
  text: z.string().min(1).max(500_000),
  metadata: z.record(z.string(), z.unknown()).default({})
});
const searchSchema = z.object({ q: z.string().min(1).max(5_000), topK: z.coerce.number().int().min(1).max(20).optional() });
const qaSchema = z.object({ question: z.string().min(1).max(5_000), topK: z.number().int().min(1).max(20).optional() });

type HttpDependencies = {
  ingestDocument: IngestDocumentUseCase;
  searchDocuments: SearchDocumentsUseCase;
  answerQuestion: AnswerQuestionUseCase;
};

function matchesApiKey(candidate: string | undefined, expected: string): boolean {
  if (!candidate) return false;
  const actual = Buffer.from(candidate);
  const wanted = Buffer.from(expected);
  return actual.length === wanted.length && timingSafeEqual(actual, wanted);
}

function applyCorsHeaders(origin: string | undefined, reply: { header: (name: string, value: string) => unknown }): boolean {
  if (!origin) return true;
  if (!config.ALLOWED_ORIGINS.includes(origin)) return false;
  reply.header("access-control-allow-origin", origin);
  reply.header("access-control-allow-methods", "GET, POST, OPTIONS");
  reply.header("access-control-allow-headers", "content-type");
  reply.header("access-control-max-age", "600");
  reply.header("vary", "Origin");
  return true;
}

export async function buildApp(dependencies: HttpDependencies) {
  const app = Fastify({ logger: true, bodyLimit: 600_000 });
  await app.register(rateLimit, {
    max: config.RATE_LIMIT_MAX,
    timeWindow: config.RATE_LIMIT_WINDOW_MS,
    errorResponseBuilder: () => ({ error: "Too many requests. Try again later." })
  });
  app.addHook("onSend", async (request, reply, payload) => {
    reply.header("cache-control", "no-store");
    reply.header("content-security-policy", "default-src 'none'; frame-ancestors 'none'; base-uri 'none'");
    reply.header("permissions-policy", "accelerometer=(), camera=(), geolocation=(), microphone=()");
    reply.header("referrer-policy", "no-referrer");
    reply.header("x-content-type-options", "nosniff");
    reply.header("x-frame-options", "DENY");
    reply.header("x-request-id", request.id);
    return payload;
  });
  app.addHook("onRequest", async (request, reply) => {
    const origin = typeof request.headers.origin === "string" ? request.headers.origin : undefined;
    const originAllowed = applyCorsHeaders(origin, reply);
    if (request.method === "OPTIONS") {
      if (!originAllowed) return reply.code(403).send({ error: "Origin not allowed" });
      return reply.code(204).send();
    }
    const providedApiKey = request.headers["x-api-key"];
    const apiKey = typeof providedApiKey === "string" ? providedApiKey : undefined;
    if (config.API_KEY && !matchesApiKey(apiKey, config.API_KEY)) return reply.code(401).send({ error: "Unauthorized" });
  });
  app.setErrorHandler((error, _request, reply) => {
    if (error instanceof ZodError) return reply.code(400).send({ error: "Invalid request", details: error.flatten() });
    if (typeof error === "object" && error !== null && "statusCode" in error && error.statusCode === 429) {
      return reply.code(429).send({ error: "Too many requests. Try again later." });
    }
    app.log.error(error);
    return reply.code(500).send({ error: "Internal server error" });
  });
  app.get("/health", async () => ({ status: "ok" }));
  app.post("/v1/documents", async (request, reply) => {
    if (config.DEMO_MODE) {
      const providedAdminKey = request.headers["x-admin-api-key"];
      const adminKey = typeof providedAdminKey === "string" ? providedAdminKey : undefined;
      if (!matchesApiKey(adminKey, config.ADMIN_API_KEY as string)) return reply.code(401).send({ error: "Unauthorized" });
    }
    const input = documentSchema.parse(request.body);
    const result = await dependencies.ingestDocument.execute(input);
    if (result.highRiskChunks > 0) {
      request.log.warn({ documentId: result.id, highRiskChunks: result.highRiskChunks }, "High-risk chunks excluded from Q&A context");
    }
    return reply.code(201).send({ documentId: result.id, chunkCount: result.chunkCount, highRiskChunks: result.highRiskChunks });
  });
  app.get("/v1/search", async (request) => {
    const { q, topK } = searchSchema.parse(request.query);
    return { results: await dependencies.searchDocuments.execute({ query: q, topK }) };
  });
  app.post("/v1/qa", { config: { rateLimit: { max: config.QA_RATE_LIMIT_MAX } } }, async (request) => {
    const { question, topK } = qaSchema.parse(request.body);
    const result = await dependencies.answerQuestion.execute({ question, topK });
    return { answer: result.answer, sources: result.sources.map(({ source, title, ordinal, score }) => ({ source, title, chunk: ordinal, score })) };
  });
  return app;
}

