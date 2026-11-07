import type {ProviderUsageObserver} from "./answer-generator.js";
import type { EmbeddingModelIdentity } from "./workspace-embedding-index.js";

export interface EmbeddingProvider {
  embed(text: string, inputType: "document" | "query", signal?: AbortSignal, onUsage?:ProviderUsageObserver): Promise<number[]>;
  forWorkspace?(tenantId: string, signal?: AbortSignal): Promise<{ provider: EmbeddingProvider; version: string; identity: EmbeddingModelIdentity }>;
}

export async function resolveWorkspaceEmbeddingIndex(embeddings: EmbeddingProvider, tenantId: string, signal?: AbortSignal): Promise<{ provider: EmbeddingProvider; version?: string; identity?: EmbeddingModelIdentity }> {
  signal?.throwIfAborted();
  return embeddings.forWorkspace ? embeddings.forWorkspace(tenantId, signal) : { provider: embeddings };
}

