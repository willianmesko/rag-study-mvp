import { timingSafeEqual } from "node:crypto";
import rateLimit from "@fastify/rate-limit";
import multipart from "@fastify/multipart";
import Fastify from "fastify";
import { createClient } from "@supabase/supabase-js";
import { ZodError, z } from "zod";
import type { AnswerQuestionUseCase } from "../../application/use-cases/answer-question.js";
import type { IngestDocumentUseCase } from "../../application/use-cases/ingest-document.js";
import type { SearchDocumentsUseCase } from "../../application/use-cases/search-documents.js";
import type { QueueDocumentUploadUseCase } from "../../application/use-cases/queue-document-upload.js";
import type { ProcessNextIngestionJobUseCase } from "../../application/use-cases/process-next-ingestion-job.js";
import type { IngestionJob } from "../../application/ports/ingestion-job-repository.js";
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
  queueDocumentUpload: QueueDocumentUploadUseCase;
  processNextIngestionJob: ProcessNextIngestionJobUseCase;
  listIngestionJobs: (limit: number) => Promise<Omit<IngestionJob, "payload">[]>;
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
  reply.header("access-control-allow-headers", "authorization, content-type, x-document-source, x-document-title");
  reply.header("access-control-max-age", "600");
  reply.header("vary", "Origin");
  return true;
}

export async function buildApp(dependencies: HttpDependencies) {
  const app = Fastify({ logger: true, bodyLimit: config.UPLOAD_MAX_BYTES + 100_000 });
  await app.register(multipart, { limits: { files: 1, fileSize: config.UPLOAD_MAX_BYTES, fields: 0 } });
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
  const authorizeAdmin = async (request: { headers: Record<string, string | string[] | undefined> }) => {
    if (!config.SUPABASE_URL || !config.SUPABASE_PUBLISHABLE_KEY || config.ADMIN_EMAILS.length === 0) return { ok: false as const, status: 503, error: "Admin upload is not configured." };
    const authorization = request.headers.authorization;
    const token = typeof authorization === "string" && authorization.startsWith("Bearer ") ? authorization.slice(7) : undefined;
    if (!token) return { ok: false as const, status: 401, error: "Authentication required." };
    const supabase = createClient(config.SUPABASE_URL, config.SUPABASE_PUBLISHABLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
    const { data, error } = await supabase.auth.getUser(token);
    const email = data.user?.email?.toLowerCase();
    if (error || !email || !config.ADMIN_EMAILS.includes(email)) return { ok: false as const, status: 403, error: "Administrator access required." };
    return { ok: true as const };
  };
  app.post("/v1/admin/uploads", async (request, reply) => {
    const authorization = await authorizeAdmin(request);
    if (!authorization.ok) return reply.code(authorization.status).send({ error: authorization.error });
    const file = await request.file();
    if (!file) return reply.code(400).send({ error: "A document file is required." });
    const sourceHeader = request.headers["x-document-source"];
    const titleHeader = request.headers["x-document-title"];
    const input = z.object({ source: z.string().min(3).max(1_000), title: z.string().min(1).max(500).optional() }).parse({ source: sourceHeader ?? `upload/${file.filename}`, title: titleHeader || undefined });
    const job = await dependencies.queueDocumentUpload.execute({ source: input.source, title: input.title, filename: file.filename, mimeType: file.mimetype || "application/octet-stream", payload: await file.toBuffer() });
    return reply.code(202).send({ job: serializeJob(job) });
  });
  app.get("/v1/admin/uploads", async (request, reply) => {
    const authorization = await authorizeAdmin(request);
    if (!authorization.ok) return reply.code(authorization.status).send({ error: authorization.error });
    return { jobs: (await dependencies.listIngestionJobs(30)).map(serializeJob) };
  });
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

function serializeJob(job: Omit<IngestionJob, "payload"> | IngestionJob) {
  return { id: job.id, source: job.source, title: job.title, filename: job.filename, mimeType: job.mimeType, status: job.status, progress: job.progress, error: job.error, chunkCount: job.chunkCount, highRiskChunks: job.highRiskChunks, createdAt: job.createdAt.toISOString(), updatedAt: job.updatedAt.toISOString() };
}

