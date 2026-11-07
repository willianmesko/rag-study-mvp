import type { Citation } from "../../../knowledge/index.js";

export type SemanticCacheEntry = { answer: string; sources: Citation[]; similarity: number };

export interface SemanticAnswerCache {
  findSimilar(input: { tenantId: string; modelKey: string; embedding: number[]; minimumSimilarity: number; embeddingIndexVersion?: string; signal?: AbortSignal }): Promise<SemanticCacheEntry | null>;
  put(input: { tenantId: string; modelKey: string; questionHash: string; embedding: number[]; answer: string; sources: Citation[]; expiresAt: Date; embeddingIndexVersion?: string }): Promise<void>;
  invalidateTenant(tenantId: string): Promise<void>;
}
