import {
  chunkSections,
  chunkText,
  type DocumentSection,
} from "../../domain/chunk.js";
import type {
  DocumentInput,
  EmbeddedChunk,
  TextChunk,
} from "../../domain/document.js";
import { assessPromptInjection } from "../../domain/security/prompt-injection.js";
import {
  resolveWorkspaceEmbeddingIndex,
  type EmbeddingProvider,
} from "../ports/embedding-provider.js";
import type { DocumentRepository } from "../ports/document-repository.js";

type IngestOptions = {
  chunkSize: number;
  chunkOverlap: number;
  embeddingConcurrency: number;
};
type Input = DocumentInput & { sections?: readonly DocumentSection[] };
export type ScannedChunk = TextChunk & {
  security: ReturnType<typeof assessPromptInjection>;
};
export type EmbeddedDocument = {
  chunks: EmbeddedChunk[];
  embeddingIndexVersion?: string;
};
type Reporter = (event: {
  stage: "chunking" | "security_scan" | "embedding" | "persistence";
  status: "started" | "completed";
  durationMs?: number;
  details?: Record<string, unknown>;
}) => Promise<void>;

export class IngestDocumentUseCase {
  constructor(
    private readonly embeddings: EmbeddingProvider,
    private readonly documents: DocumentRepository,
    private readonly options: IngestOptions,
  ) {}
  createChunks(input: Input): TextChunk[] {
    const { chunkSize, chunkOverlap } = this.options;
    const chunks = input.sections?.length
      ? chunkSections(input.sections, chunkSize, chunkOverlap)
      : chunkText(input.text, chunkSize, chunkOverlap);
    if (chunks.length > 512)
      throw new Error(
        "This document exceeds the 512-passage processing budget. Split it into smaller files.",
      );
    return chunks;
  }
  scan(chunks: readonly TextChunk[]): ScannedChunk[] {
    return chunks.map((chunk) => ({
      ...chunk,
      security: assessPromptInjection(chunk.content),
    }));
  }
  async embed(
    tenantId: string,
    chunks: readonly ScannedChunk[],
    signal?: AbortSignal,
  ): Promise<EmbeddedDocument> {
    signal?.throwIfAborted();
    const index = await resolveWorkspaceEmbeddingIndex(
      this.embeddings,
      tenantId,
      signal,
    );
    const controller = new AbortController();
    const execution = signal
      ? AbortSignal.any([signal, controller.signal])
      : controller.signal;
    const output = new Array<EmbeddedChunk>(chunks.length);
    let next = 0;
    const workers = Array.from(
      { length: Math.min(this.options.embeddingConcurrency, chunks.length) },
      async () => {
        while (next < chunks.length) {
          execution.throwIfAborted();
          const position = next++;
          const chunk = chunks[position]!;
          const embedding = await index.provider.embed(
            chunk.content,
            "document",
            execution,
          );
          execution.throwIfAborted();
          output[position] = { ...chunk, embedding };
        }
      },
    );
    try {
      await Promise.all(workers);
    } catch (error) {
      controller.abort(error);
      await Promise.allSettled(workers);
      throw error;
    }
    return {
      chunks: output,
      ...(index.version ? { embeddingIndexVersion: index.version } : {}),
    };
  }
  persist(input: Input, embedded: EmbeddedDocument, signal?: AbortSignal) {
    signal?.throwIfAborted();
    return this.documents.replace(
      {
        tenantId: input.tenantId,
        source: input.source,
        title: input.title,
        metadata: input.metadata ?? {},
        embeddingIndexVersion: embedded.embeddingIndexVersion,
      },
      embedded.chunks,
    );
  }
  async execute(
    input: Input,
    report?: Reporter,
    signal?: AbortSignal,
  ): Promise<{ id: string; chunkCount: number; highRiskChunks: number }> {
    const stage = async <T>(
      name: Parameters<Reporter>[0]["stage"],
      work: () => Promise<T>,
      details: (result: T) => Record<string, unknown>,
    ) => {
      signal?.throwIfAborted();
      const started = Date.now();
      await report?.({ stage: name, status: "started" });
      const result = await work();
      signal?.throwIfAborted();
      await report?.({
        stage: name,
        status: "completed",
        durationMs: Date.now() - started,
        details: details(result),
      });
      return result;
    };
    const chunks = await stage(
      "chunking",
      async () => this.createChunks(input),
      (value) => ({ chunkCount: value.length }),
    );
    const scanned = await stage(
      "security_scan",
      async () => this.scan(chunks),
      (value) => ({
        highRiskChunks: value.filter(
          ({ security }) => security.promptInjectionRisk === "high",
        ).length,
      }),
    );
    const embedded = await stage(
      "embedding",
      () => this.embed(input.tenantId, scanned, signal),
      (value) => ({ vectorCount: value.chunks.length }),
    );
    const persisted = await stage(
      "persistence",
      () => this.persist(input, embedded, signal),
      (value) => ({ documentId: value.id }),
    );
    return {
      ...persisted,
      highRiskChunks: scanned.filter(
        ({ security }) => security.promptInjectionRisk === "high",
      ).length,
    };
  }
}
