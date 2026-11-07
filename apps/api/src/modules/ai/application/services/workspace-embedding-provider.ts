import type { EmbeddingProvider } from "../ports/embedding-provider.js";
import type { ModelProviderRegistry } from "../ports/model-runtime-providers.js";
import { validateWorkspaceEmbedding, type EmbeddingModelIdentity, type WorkspaceEmbeddingIndexResolver } from "../ports/workspace-embedding-index.js";
import { RedactingEmbeddingProvider } from "./redacting-embedding-provider.js";

/** Both workspace ingestion and direct MCP query adapters use the same boundary. */
export function createWorkspaceEmbeddingAdapter(identity: EmbeddingModelIdentity, registry: Pick<ModelProviderRegistry, "createEmbedding">): EmbeddingProvider {
  const redacting = new RedactingEmbeddingProvider(registry.createEmbedding(identity));
  return {
    async embed(text, inputType, signal, onUsage) {
      const vector = await redacting.embed(text, inputType, signal, onUsage);
      validateWorkspaceEmbedding(vector);
      return vector;
    },
  };
}

export function createWorkspaceEmbeddingProvider(
  index: WorkspaceEmbeddingIndexResolver,
  initial: EmbeddingModelIdentity,
  factory: (identity: EmbeddingModelIdentity, tenantId: string) => EmbeddingProvider,
): EmbeddingProvider {
  return {
    async embed() { throw new Error("Workspace scope is required to generate an embedding."); },
    async forWorkspace(tenantId, signal) {
      signal?.throwIfAborted();
      const identity = await index.getOrPinActive(tenantId, initial, signal);
      signal?.throwIfAborted();
      return { provider: factory(identity, tenantId), version: identity.revision, identity };
    },
  };
}
