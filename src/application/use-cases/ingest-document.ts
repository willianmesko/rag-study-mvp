import { chunkText } from "../../domain/chunk.js";
import type { DocumentInput, EmbeddedChunk } from "../../domain/document.js";
import { assessPromptInjection } from "../../domain/security/prompt-injection.js";
import type { EmbeddingProvider } from "../ports/embedding-provider.js";
import type { DocumentRepository } from "../ports/document-repository.js";

type IngestOptions = {
  chunkSize: number;
  chunkOverlap: number;
  embeddingConcurrency: number;
};

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

  async execute(input: DocumentInput): Promise<{ id: string; chunkCount: number; highRiskChunks: number }> {
    const chunks = chunkText(input.text, this.options.chunkSize, this.options.chunkOverlap);
    // Embedding happens before persistence so an unavailable provider cannot remove
    // the last successfully indexed version of this source.
    const vectors = await mapWithConcurrency(chunks, this.options.embeddingConcurrency, (chunk) =>
      this.embeddings.embed(chunk.content, "document")
    );
    const embeddedChunks: EmbeddedChunk[] = chunks.map((chunk, index) => ({
      ...chunk,
      embedding: vectors[index] as number[],
      security: assessPromptInjection(chunk.content)
    }));

    const persisted = await this.documents.replace(
      { source: input.source, title: input.title, metadata: input.metadata ?? {} },
      embeddedChunks
    );
    return {
      ...persisted,
      highRiskChunks: embeddedChunks.filter((chunk) => chunk.security.promptInjectionRisk === "high").length
    };
  }
}

