import "dotenv/config";
import { z } from "zod";

const provider = z.enum(["ollama", "openrouter", "bedrock"]);
const rerankerProvider = z.enum(["none", "jina"]);
const booleanEnvironment = z.enum(["true", "false"]).transform((value) => value === "true");

const environment = z.object({
  DATABASE_URL: z.string().url().default("postgresql://rag:rag@localhost:5433/rag"),
  AWS_REGION: z.string().min(1).default("us-east-1"),
  AWS_PROFILE: z.string().min(1).optional(),
  EMBEDDING_PROVIDER: provider.default("ollama"),
  CHAT_PROVIDER: provider.default("ollama"),
  EMBEDDING_DIMENSIONS: z.coerce.number().int().positive().default(1024),
  BEDROCK_EMBEDDING_MODEL_ID: z.string().min(1).default("amazon.titan-embed-text-v2:0"),
  BEDROCK_CHAT_MODEL_ID: z.string().min(1).default("global.anthropic.claude-haiku-4-5-20251001-v1:0"),
  OLLAMA_BASE_URL: z.string().url().default("http://localhost:11434"),
  OLLAMA_EMBEDDING_MODEL: z.string().min(1).default("mxbai-embed-large"),
  OLLAMA_CHAT_MODEL: z.string().min(1).default("llama3.2"),
  OPENROUTER_BASE_URL: z.string().url().default("https://openrouter.ai/api/v1"),
  OPENROUTER_API_KEY: z.string().min(1).optional(),
  OPENROUTER_EMBEDDING_MODEL: z.string().min(1).default("openai/text-embedding-3-small"),
  OPENROUTER_CHAT_MODEL: z.string().min(1).default("openai/gpt-4o-mini"),
  RERANKER_PROVIDER: rerankerProvider.default("none"),
  RERANKER_CANDIDATE_MULTIPLIER: z.coerce.number().int().min(1).max(20).default(4),
  JINA_BASE_URL: z.string().url().default("https://api.jina.ai/v1"),
  JINA_API_KEY: z.string().min(1).optional(),
  JINA_RERANKER_MODEL: z.string().min(1).default("jina-reranker-v2-base-multilingual"),
  LANGSMITH_TRACING: booleanEnvironment.default(false),
  LANGSMITH_API_KEY: z.string().min(1).optional(),
  LANGSMITH_PROJECT: z.string().min(1).default("rag-study-mvp"),
  HOST: z.string().min(1).default("127.0.0.1"),
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  CHUNK_SIZE: z.coerce.number().int().min(200).max(10_000).default(1200),
  CHUNK_OVERLAP: z.coerce.number().int().min(0).max(5_000).default(200),
  RETRIEVAL_TOP_K: z.coerce.number().int().min(1).max(20).default(5),
  HYBRID_VECTOR_CANDIDATE_MULTIPLIER: z.coerce.number().int().min(1).max(20).default(4),
  HYBRID_KEYWORD_CANDIDATE_MULTIPLIER: z.coerce.number().int().min(1).max(20).default(4),
  RRF_K: z.coerce.number().int().min(1).max(1_000).default(60),
  RAG_MINIMUM_SCORE: z.coerce.number().min(-1).max(1).default(0.3),
  RATE_LIMIT_MAX: z.coerce.number().int().min(1).max(10_000).default(60),
  QA_RATE_LIMIT_MAX: z.coerce.number().int().min(1).max(1_000).default(10),
  DAILY_TENANT_QA_LIMIT: z.coerce.number().int().min(1).max(100_000).default(200),
  DAILY_ADMIN_UPLOAD_BYTES_LIMIT: z.coerce.number().int().min(1_000).max(1_000_000_000).default(20_000_000),
  RATE_LIMIT_WINDOW_MS: z.coerce.number().int().min(1_000).max(3_600_000).default(60_000),
  PROVIDER_TIMEOUT_MS: z.coerce.number().int().min(1_000).max(120_000).default(30_000),
  API_KEY: z.string().min(16).optional(),
  // Public demos expose only read/query routes. The ingestion route remains an
  // administrative operation so visitors cannot change the corpus or trigger
  // arbitrary embedding costs.
  DEMO_MODE: booleanEnvironment.default(false),
  ADMIN_API_KEY: z.string().min(16).optional(),
  SUPABASE_URL: z.string().url().optional(),
  SUPABASE_PUBLISHABLE_KEY: z.string().min(1).optional(),
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(1).optional(),
  SUPABASE_UPLOAD_BUCKET: z.string().min(3).max(63).default("rag-originals"),
  DEFAULT_TENANT_ID: z.string().uuid().default("00000000-0000-4000-8000-000000000001"),
  ADMIN_EMAILS: z.string().optional().transform((value) =>
    (value ?? "").split(",").map((email) => email.trim().toLowerCase()).filter(Boolean)
  ),
  UPLOAD_MAX_BYTES: z.coerce.number().int().min(1_000).max(10_000_000).default(5_000_000),
  INGESTION_WORKER_INTERVAL_MS: z.coerce.number().int().min(1_000).max(60_000).default(5_000),
  // Comma-separated browser origins. Keep this empty during local development,
  // where Vite proxies requests, and set it to the published frontend URL.
  ALLOWED_ORIGINS: z.string().optional().transform((value) =>
    (value ?? "").split(",").map((origin) => origin.trim()).filter(Boolean)
  )
});

export const config = environment.parse(process.env);

if (config.CHUNK_OVERLAP >= config.CHUNK_SIZE) {
  throw new Error("CHUNK_OVERLAP must be smaller than CHUNK_SIZE.");
}

// The DDL intentionally pins the dimension. Keeping both values aligned stops a
// subtle class of errors where embeddings are accepted but cannot be compared.
if (config.EMBEDDING_DIMENSIONS !== 1024) {
  throw new Error(
    "This MVP schema uses vector(1024). Update db/migrations/001_initial.sql before changing EMBEDDING_DIMENSIONS."
  );
}

if ((config.EMBEDDING_PROVIDER === "openrouter" || config.CHAT_PROVIDER === "openrouter") && !config.OPENROUTER_API_KEY) {
  throw new Error("OPENROUTER_API_KEY is required when OPENROUTER is the selected provider.");
}

if (config.RERANKER_PROVIDER === "jina" && !config.JINA_API_KEY) {
  throw new Error("JINA_API_KEY is required when RERANKER_PROVIDER=jina.");
}

if (config.LANGSMITH_TRACING && !config.LANGSMITH_API_KEY) {
  throw new Error("LANGSMITH_API_KEY is required when LANGSMITH_TRACING=true.");
}

if (config.DEMO_MODE && !config.ADMIN_API_KEY) {
  throw new Error("ADMIN_API_KEY is required when DEMO_MODE=true.");
}

if (config.DEMO_MODE && config.API_KEY) {
  throw new Error("API_KEY protects every route and cannot be combined with public DEMO_MODE. Use ADMIN_API_KEY for ingestion instead.");
}

if ((config.SUPABASE_URL && !config.SUPABASE_PUBLISHABLE_KEY) || (!config.SUPABASE_URL && config.SUPABASE_PUBLISHABLE_KEY)) {
  throw new Error("SUPABASE_URL and SUPABASE_PUBLISHABLE_KEY must be configured together.");
}

