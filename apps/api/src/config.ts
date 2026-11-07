import dotenv from "dotenv";
import { fileURLToPath } from "node:url";
import { chatModelIdSchema } from "@rag-study/contracts";
import { z } from "zod";

// Keep the developer-facing .env at the monorepo root while the API runs from
// apps/api. Container deployments rely on real environment variables instead.
dotenv.config({ path: fileURLToPath(new URL("../../../.env", import.meta.url)) });

const provider = z.enum(["ollama", "openrouter", "bedrock"]);
const rerankerProvider = z.enum(["none", "jina"]);
const booleanEnvironment = z.enum(["true", "false"]).transform((value) => value === "true");
const modelName = z.string().trim().min(1).max(200).regex(/^[A-Za-z0-9][A-Za-z0-9._/:@-]*$/);
const additionalChatModels = z.string().default("[]").transform((raw, ctx): unknown => {
  try {
    return JSON.parse(raw);
  } catch {
    ctx.addIssue({ code: "custom", message: "Expected a JSON array of additional models." });
    return z.NEVER;
  }
}).pipe(z.array(z.strictObject({
  id: chatModelIdSchema.refine((id) => id !== "default" && id !== "auto", { message: "The default and auto aliases are reserved." }),
  label: z.string().trim().min(1).max(80),
  model: modelName,
  provider: provider.optional(),
  inputCostPer1kUsd: z.number().min(0).max(10),
  outputCostPer1kUsd: z.number().min(0).max(10)
})).max(5).refine((models) => new Set(models.map(({ id }) => id)).size === models.length, { message: "Model aliases must be unique." }));

const environment = z.object({
  DATABASE_URL: z.string().url().default("postgresql://rag:rag@localhost:5433/rag"),
  AWS_REGION: z.string().min(1).default("us-east-1"),
  AWS_PROFILE: z.string().min(1).optional(),
  EMBEDDING_PROVIDER: provider.default("ollama"),
  CHAT_PROVIDER: provider.default("ollama"),
  CHAT_DEFAULT_MODEL_LABEL: z.string().trim().min(1).max(80).optional(),
  CHAT_ADDITIONAL_MODELS: additionalChatModels,
  EVAL_FAITHFULNESS_JUDGE_MODEL: modelName.optional(),
  EVAL_JUDGE_INPUT_COST_PER_1K_USD:z.coerce.number().min(0).max(10).default(0.001),
  EVAL_JUDGE_OUTPUT_COST_PER_1K_USD:z.coerce.number().min(0).max(10).default(0.005),
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
  OTEL_ENABLED:booleanEnvironment.default(false),
  OTEL_EXPORTER_OTLP_ENDPOINT:z.string().url().optional(),
  OTEL_EXPORTER_OTLP_METRICS_ENDPOINT:z.string().url().optional(),
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  CHUNK_SIZE: z.coerce.number().int().min(200).max(10_000).default(1200),
  CHUNK_OVERLAP: z.coerce.number().int().min(0).max(5_000).default(200),
  RETRIEVAL_TOP_K: z.coerce.number().int().min(1).max(20).default(5),
  HYBRID_VECTOR_CANDIDATE_MULTIPLIER: z.coerce.number().int().min(1).max(20).default(4),
  HYBRID_KEYWORD_CANDIDATE_MULTIPLIER: z.coerce.number().int().min(1).max(20).default(4),
  RRF_K: z.coerce.number().int().min(1).max(1_000).default(60),
  RAG_MINIMUM_SCORE: z.coerce.number().min(-1).max(1).default(0.3),
  AGENT_MAX_STEPS: z.coerce.number().int().min(1).max(50).default(8),
  AGENT_TIMEOUT_MS: z.coerce.number().int().min(1_000).max(120_000).default(30_000),
  WORKFLOWS_ENABLED:booleanEnvironment.default(false),
  WORKFLOW_STATE_KEYS:z.string().min(1).max(4096).optional(),
  WORKFLOW_STATE_ACTIVE_KEY_ID:z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,39}$/).optional(),
  WORKFLOW_STATE_KEY:z.string().regex(/^[A-Za-z0-9+/]{43}=$/).optional(),
  WORKFLOW_INGEST_MAX_COST_USD:z.coerce.number().min(0).max(10).default(0.1),
  WORKFLOW_EVAL_MAX_COST_USD:z.coerce.number().min(0).max(10).default(0.2),
  EMBEDDING_LEDGER_INPUT_COST_PER_1K_USD:z.coerce.number().min(0).max(10).optional(),
  JINA_INPUT_COST_PER_1K_USD:z.coerce.number().min(0).max(10).optional(),
  EMBEDDING_INPUT_COST_PER_1K_USD:z.coerce.number().min(0).max(10).default(0.001),
  RAG_CLAIM_MODE:z.enum(['model','extractive']).default('model'),
  MCP_ENABLED: booleanEnvironment.default(false),
  MCP_READ_DATABASE_URL: z.string().url().optional(),
  MCP_REMOTE_ENABLED: booleanEnvironment.default(false),
  MCP_PUBLIC_URL: z.string().url().optional(),
  MCP_REMOTE_ALLOWED_ORIGINS: z.string().optional().transform((value) => (value ?? "").split(",").map((item) => item.trim()).filter(Boolean)),
  MCP_CALLS_PER_MINUTE: z.coerce.number().int().min(1).max(1000).default(10),
  MCP_CALLS_PER_DAY: z.coerce.number().int().min(1).max(10000).default(400),
  MCP_PROVIDER_CALLS_PER_DAY: z.coerce.number().int().min(1).max(10000).default(100),
  MCP_INPUT_TOKENS_PER_DAY: z.coerce.number().int().min(1).max(1_000_000).default(100_000),
  MCP_USER_COST_USD_PER_DAY: z.coerce.number().min(0).max(10).default(0.01),
  MCP_WORKSPACE_COST_USD_PER_DAY: z.coerce.number().min(0).max(100).default(0.05),
  MCP_COST_USD_PER_CALL: z.coerce.number().min(0).max(1).default(0.005),
  MCP_CONCURRENT_PROVIDERS: z.coerce.number().int().min(1).max(4).default(2),
  AGENT_ACTIONS_ENABLED: booleanEnvironment.default(false),
  CHAT_MAX_OUTPUT_TOKENS: z.coerce.number().int().min(1).max(16_000).default(500),
  CHAT_AUTO_MAX_TOTAL_INPUT_TOKENS: z.coerce.number().int().min(1).max(500_000).default(120_000),
  CHAT_AUTO_MAX_TOTAL_OUTPUT_TOKENS: z.coerce.number().int().min(1).max(64_000).optional(),
  REQUIRE_STRUCTURED_ANSWER: booleanEnvironment.default(false),
  MAX_ESTIMATED_COST_USD_PER_REQUEST: z.coerce.number().min(0).max(100).default(0.05),
  RATE_LIMIT_MAX: z.coerce.number().int().min(1).max(10_000).default(60),
  QA_RATE_LIMIT_MAX: z.coerce.number().int().min(1).max(1_000).default(10),
  DAILY_TENANT_QA_LIMIT: z.coerce.number().int().min(1).max(100_000).default(200),
  DAILY_USER_QA_LIMIT: z.coerce.number().int().min(1).max(10_000).default(30),
  DAILY_ADMIN_UPLOAD_BYTES_LIMIT: z.coerce.number().int().min(1_000).max(1_000_000_000).default(20_000_000),
  SEMANTIC_CACHE_TTL_SECONDS: z.coerce.number().int().min(60).max(604_800).default(3_600),
  SEMANTIC_CACHE_MINIMUM_SIMILARITY: z.coerce.number().min(0.7).max(1).default(0.96),
  ESTIMATED_INPUT_COST_PER_1K_USD: z.coerce.number().min(0).max(10).default(0.00015),
  ESTIMATED_OUTPUT_COST_PER_1K_USD: z.coerce.number().min(0).max(10).default(0.0006),
  BUDGET_ALERT_WEBHOOK_URL:z.string().url().optional(),
  BUDGET_ALERT_WEBHOOK_SECRET:z.string().min(32).max(256).optional(),
  USAGE_ALERT_THRESHOLD_USD: z.coerce.number().min(0).max(100_000).default(1),
  USAGE_HASH_SECRET: z.string().min(32).optional(),
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
  APP_BASE_URL: z.string().url().optional(),
  SUPABASE_UPLOAD_BUCKET: z.string().min(3).max(63).default("rag-originals"),
  DEFAULT_TENANT_ID: z.string().uuid().default("00000000-0000-4000-8000-000000000001"),
  ADMIN_EMAILS: z.string().optional().transform((value) =>
    (value ?? "").split(",").map((email) => email.trim().toLowerCase()).filter(Boolean)
  ),
  UPLOAD_MAX_BYTES: z.coerce.number().int().min(1_000).max(10_000_000).default(5_000_000),
  INGESTION_WORKER_INTERVAL_MS: z.coerce.number().int().min(1_000).max(60_000).default(5_000),
  PDF_OCR_ENABLED: booleanEnvironment.default(false),
  PDF_OCR_LANGUAGES: z.enum(["eng", "por", "eng+por", "por+eng"]).default("eng+por"),
  PDF_OCR_MAX_PAGES: z.coerce.number().int().min(1).max(20).default(8),
  PDF_OCR_TIMEOUT_MS: z.coerce.number().int().min(1_000).max(90_000).default(45_000),
  // Comma-separated browser origins. Keep this empty during local development,
  // where Vite proxies requests, and set it to the published frontend URL.
  ALLOWED_ORIGINS: z.string().optional().transform((value) =>
    (value ?? "").split(",").map((origin) => origin.trim()).filter(Boolean)
  )
});

export const config = environment.parse(process.env);
if (config.MCP_REMOTE_ENABLED && (!config.MCP_ENABLED || !config.MCP_PUBLIC_URL || !config.APP_BASE_URL || !config.SUPABASE_URL || !config.SUPABASE_PUBLISHABLE_KEY))
  throw new Error("Remote MCP requires MCP_ENABLED, MCP_PUBLIC_URL, APP_BASE_URL and Supabase authentication.");
if (config.WORKFLOWS_ENABLED && !config.WORKFLOW_STATE_KEY && !(config.WORKFLOW_STATE_KEYS && config.WORKFLOW_STATE_ACTIVE_KEY_ID)) throw new Error("WORKFLOW_STATE_KEY is required when WORKFLOWS_ENABLED=true.");

if (config.CHUNK_OVERLAP >= config.CHUNK_SIZE) {
  throw new Error("CHUNK_OVERLAP must be smaller than CHUNK_SIZE.");
}

// The DDL intentionally pins the dimension. Keeping both values aligned stops a
// subtle class of errors where embeddings are accepted but cannot be compared.
if (config.EMBEDDING_DIMENSIONS !== 1024) {
  throw new Error(
    "This MVP schema uses vector(1024). Update apps/api/db/migrations/001_initial.sql before changing EMBEDDING_DIMENSIONS."
  );
}

if ((config.EMBEDDING_PROVIDER === "openrouter" || config.CHAT_PROVIDER === "openrouter" || config.EVAL_FAITHFULNESS_JUDGE_MODEL ||
  config.CHAT_ADDITIONAL_MODELS.some(({ provider: modelProvider }) => modelProvider === "openrouter")) && !config.OPENROUTER_API_KEY) {
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

if ((config.MCP_ENABLED || config.AGENT_ACTIONS_ENABLED) &&
  (!config.SUPABASE_URL || !config.SUPABASE_PUBLISHABLE_KEY || config.API_KEY)) {
  throw new Error("Workspace MCP and approved actions require Supabase Auth without the legacy global API key.");
}

if ((config.SUPABASE_URL && !config.SUPABASE_PUBLISHABLE_KEY) || (!config.SUPABASE_URL && config.SUPABASE_PUBLISHABLE_KEY)) {
  throw new Error("SUPABASE_URL and SUPABASE_PUBLISHABLE_KEY must be configured together.");
}

