import { chunkSections, chunkText, type DocumentSection } from "../../domain/chunk.js";
import type { DocumentInput, EmbeddedChunk } from "../../domain/document.js";
import { assessPromptInjection } from "../../domain/security/prompt-injection.js";
import { resolveWorkspaceEmbeddingIndex, type EmbeddingProvider } from "../ports/embedding-provider.js";
import type { DocumentRepository } from "../ports/document-repository.js";

type IngestOptions = {
  chunkSize: number;
  chunkOverlap: number;
  embeddingConcurrency: number;
};

type IngestionStageReporter = (event: {
  stage: "chunking" | "security_scan" | "embedding" | "persistence";
  status: "started" | "completed";
  durationMs?: number;
  details?: Record<string, unknown>;
}) => Promise<void>;

async function mapWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  work: (item: T) => Promise<R>
): Promise<R[]> {
  const output = new Array<R>(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(concurrency, items.length) }, async () => {
      while (next < items.length) {
        const index = next++;
        output[index] = await work(items[index] as T);
      }
    })
  );
  return output;
}

export class IngestDocumentUseCase {
  constructor(
    private readonly embeddings: EmbeddingProvider,
    private readonly documents: DocumentRepository,
    private readonly options: IngestOptions
  ) {}

  async execute(input: DocumentInput & { sections?: readonly DocumentSection[] }, report?: IngestionStageReporter): Promise<{ id: string; chunkCount: number; highRiskChunks: number }> {
    const chunkStartedAt = Date.now();
    await report?.({ stage: "chunking", status: "started" });
    const { chunkSize, chunkOverlap } = this.options;
    const chunks = input.sections?.length
      ? chunkSections(input.sections, chunkSize, chunkOverlap)
      : chunkText(input.text, chunkSize, chunkOverlap);
    await report?.({ stage: "chunking", status: "completed", durationMs: Date.now() - chunkStartedAt, details: { chunkCount: chunks.length } });
    const securityStartedAt = Date.now();
    await report?.({ stage: "security_scan", status: "started" });
    const security = chunks.map((chunk) => assessPromptInjection(chunk.content));
    const highRiskChunks = security.filter((assessment) => assessment.promptInjectionRisk === "high").length;
    await report?.({ stage: "security_scan", status: "completed", durationMs: Date.now() - securityStartedAt, details: { highRiskChunks } });
    // Embedding happens before persistence so an unavailable provider cannot remove
    // the last successfully indexed version of this source.
    const embeddingStartedAt = Date.now();
    await report?.({ stage: "embedding", status: "started", details: { vectorCount: chunks.length } });
    const index = await resolveWorkspaceEmbeddingIndex(this.embeddings, input.tenantId);
    const vectors = await mapWithConcurrency(chunks, this.options.embeddingConcurrency, (chunk) =>
      index.provider.embed(chunk.content, "document")
    );
    await report?.({ stage: "embedding", status: "completed", durationMs: Date.now() - embeddingStartedAt, details: { vectorCount: vectors.length } });
    const embeddedChunks: EmbeddedChunk[] = chunks.map((chunk, index) => ({
      ...chunk,
      embedding: vectors[index] as number[],
      security: security[index]!
    }));

    const persistenceStartedAt = Date.now();
    await report?.({ stage: "persistence", status: "started" });
    const persisted = await this.documents.replace(
      { tenantId: input.tenantId, source: input.source, title: input.title, metadata: input.metadata ?? {},
        ...(index.version ? { embeddingIndexVersion: index.version } : {}) },
      embeddedChunks
    );
    await report?.({ stage: "persistence", status: "completed", durationMs: Date.now() - persistenceStartedAt, details: { documentId: persisted.id } });
    return {
      ...persisted,
      highRiskChunks
    };
  }
}

