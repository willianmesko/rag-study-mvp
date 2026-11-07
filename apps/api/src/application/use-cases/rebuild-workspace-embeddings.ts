import type { EmbeddingProvider } from "../ports/embedding-provider.js";
import { validateWorkspaceEmbedding, type WorkspaceEmbeddingIndexRepository } from "../ports/workspace-embedding-index.js";

export async function rebuildWorkspaceEmbeddings(
  repository: WorkspaceEmbeddingIndexRepository,
  provider: EmbeddingProvider,
  input: { tenantId: string; versionId: string; maxChunks: number; signal?: AbortSignal }
): Promise<{ processedChunks: number; stagedVectors: number }> {
  let processedChunks = 0;
  let stagedVectors = 0;
  while (processedChunks < input.maxChunks) {
    input.signal?.throwIfAborted();
    const chunks = await repository.nextUnindexedChunks(input.tenantId, input.versionId, Math.min(4, input.maxChunks - processedChunks));
    if (chunks.length === 0) break;
    const vectors = await Promise.all(chunks.map(async ({ id, content }) => {
      const embedding = await provider.embed(content, "document", input.signal);
      validateWorkspaceEmbedding(embedding);
      return { id, embedding };
    }));
    input.signal?.throwIfAborted();
    processedChunks += vectors.length;
    stagedVectors += await repository.stageVectors(input.tenantId, input.versionId, vectors);
  }
  return { processedChunks, stagedVectors };
}
