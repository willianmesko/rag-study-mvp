export const workspaceEmbeddingDimensions = 1024;

export type EmbeddingModelIdentity = {
  provider: "ollama" | "openrouter" | "bedrock";
  model: string;
  dimensions: number;
};

export type WorkspaceEmbeddingVersion = EmbeddingModelIdentity & {
  id: string;
  revision: string;
  state: "active" | "building" | "previous";
};

export interface WorkspaceEmbeddingIndexRepository {
  nextUnindexedChunks(tenantId: string, versionId: string, limit: number): Promise<Array<{ id: string; content: string }>>;
  stageVectors(tenantId: string, versionId: string, vectors: Array<{ id: string; embedding: number[] }>): Promise<number>;
}

export class EmbeddingIndexChangedError extends Error {
  constructor() {
    super("The workspace embedding index changed. Retry with its active version.");
    this.name = "EmbeddingIndexChangedError";
  }
}

export function validateWorkspaceEmbedding(embedding: number[]): void {
  if (embedding.length !== workspaceEmbeddingDimensions) {
    throw new Error(`Workspace embeddings require ${workspaceEmbeddingDimensions} dimensions, received ${embedding.length}.`);
  }
  if (!embedding.every((value) => Number.isFinite(Math.fround(value))) || !embedding.some((value) => Math.fround(value) !== 0)) {
    throw new Error("A workspace embedding must be a finite, nonzero vector.");
  }
}
