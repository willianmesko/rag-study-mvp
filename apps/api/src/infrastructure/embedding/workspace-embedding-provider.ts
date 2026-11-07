import type { Pool } from "pg";
import type { EmbeddingProvider } from "../../application/ports/embedding-provider.js";
import { validateWorkspaceEmbedding, type EmbeddingModelIdentity } from "../../application/ports/workspace-embedding-index.js";
import { config } from "../../config.js";
import { createBedrockClient } from "../bedrock/client.js";
import { TitanEmbeddingProvider } from "../bedrock/titan-embedding-provider.js";
import { OllamaEmbeddingProvider } from "../ollama/ollama-embedding-provider.js";
import { OpenRouterEmbeddingProvider } from "../openrouter/openrouter-embedding-provider.js";
import { PgWorkspaceEmbeddingIndex } from "../postgres/pg-workspace-embedding-index.js";
import { RedactingEmbeddingProvider } from "../security/redacting-embedding-provider.js";

let bedrockClient: ReturnType<typeof createBedrockClient> | undefined;

export function defaultWorkspaceEmbeddingModel(): EmbeddingModelIdentity {
  const model = {
    ollama: config.OLLAMA_EMBEDDING_MODEL,
    openrouter: config.OPENROUTER_EMBEDDING_MODEL,
    bedrock: config.BEDROCK_EMBEDDING_MODEL_ID
  }[config.EMBEDDING_PROVIDER];
  return { provider: config.EMBEDDING_PROVIDER, model, dimensions: config.EMBEDDING_DIMENSIONS };
}

export function createWorkspaceEmbeddingAdapter(identity: EmbeddingModelIdentity): EmbeddingProvider {
  const { provider, model, dimensions } = identity;
  let adapter: EmbeddingProvider;
  switch (provider) {
    case "ollama":
      adapter = new OllamaEmbeddingProvider(config.OLLAMA_BASE_URL, model, dimensions);
      break;
    case "openrouter":
      if (!config.OPENROUTER_API_KEY) throw new Error("The workspace embedding index requires an OpenRouter API key.");
      adapter = new OpenRouterEmbeddingProvider(config.OPENROUTER_BASE_URL, config.OPENROUTER_API_KEY, model, dimensions);
      break;
    case "bedrock":
      bedrockClient ??= createBedrockClient(config.AWS_REGION);
      adapter = new TitanEmbeddingProvider(bedrockClient, model, dimensions);
      break;
  }
  const redacting = new RedactingEmbeddingProvider(adapter);
  return {
    async embed(text, inputType, signal,onUsage) {
      const vector = await redacting.embed(text, inputType, signal,onUsage);
      validateWorkspaceEmbedding(vector);
      return vector;
    }
  };
}

export function createWorkspaceEmbeddingProvider(pool: Pool,factory:(identity:EmbeddingModelIdentity,tenantId:string)=>EmbeddingProvider=(identity)=>createWorkspaceEmbeddingAdapter(identity)): EmbeddingProvider {
  const index = new PgWorkspaceEmbeddingIndex(pool);
  const initial = defaultWorkspaceEmbeddingModel();
  return {
    async embed() { throw new Error("Workspace scope is required to generate an embedding."); },
    async forWorkspace(tenantId, signal) {
      signal?.throwIfAborted();
      const identity = await index.getOrPinActive(tenantId, initial);
      signal?.throwIfAborted();
      return { provider: factory(identity,tenantId), version: identity.revision, identity };
    }
  };
}
