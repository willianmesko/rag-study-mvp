import { createHash } from "node:crypto";
import { Annotation, END, START, StateGraph } from "@langchain/langgraph";
import type {
  DocumentTextExtractor,
  ExtractedDocument,
  NativeDocumentExtraction,
} from "../../application/ports/document-text-extractor.js";
import type {
  IngestionJobRepository,
  IngestionJob,
} from "../../application/ports/ingestion-job-repository.js";
import type { OriginalFileStore } from "../../application/ports/original-file-store.js";
import type { SemanticAnswerCache } from "../../application/ports/semantic-answer-cache.js";
import {
  IngestDocumentUseCase,
  type EmbeddedDocument,
  type ScannedChunk,
} from "../../application/use-cases/ingest-document.js";
import { workflowNode } from "../../application/workflows/execution-context.js";
import { WorkflowGuardError } from "../../application/workflows/types.js";
import type { TextChunk } from "../../domain/document.js";
import { detectDocumentLanguage } from "../ingestion/document-language.js";
import { hasReadableContent } from "../ingestion/document-text-extractor.js";
import { graphExecution } from "./graph-execution.js";

const State = Annotation.Root({
  jobId: Annotation<string>,
  tenantId: Annotation<string>,
  sourceHash: Annotation<string>,
  bytes: Annotation<number>,
  native: Annotation<NativeDocumentExtraction>,
  document: Annotation<ExtractedDocument>,
  needsOcr: Annotation<boolean>,
  chunks: Annotation<TextChunk[]>,
  scanned: Annotation<ScannedChunk[]>,
  embedded: Annotation<EmbeddedDocument>,
  result: Annotation<{
    id: string;
    chunkCount: number;
    highRiskChunks: number;
  }>,
});
export const ingestionWorkflowVersion = "ingestion-v2";

export class LangGraphIngestionWorkflow {
  constructor(
    private readonly jobs: IngestionJobRepository,
    private readonly extractor: DocumentTextExtractor,
    private readonly ingest: IngestDocumentUseCase,
    private readonly originals: OriginalFileStore,
    private readonly cache: SemanticAnswerCache,
  ) {}
  async execute(job: IngestionJob, signal: AbortSignal) {
    let payload: Buffer | undefined;
    const read = async (hash?: string) => {
      signal.throwIfAborted();
      if (!payload) {
        const current = await this.jobs.readForProcessing?.(
          job.id,
          job.tenantId,
        );
        if (!current || current.status === "failed")
          throw new WorkflowGuardError("authorization_revoked");
        payload =
          current.payload ??
          (current.storagePath
            ? await this.originals.get(current.storagePath)
            : undefined);
        if (!payload) throw new Error("The original file is unavailable.");
      }
      if (hash && createHash("sha256").update(payload).digest("hex") !== hash)
        throw new WorkflowGuardError("definition_changed");
      signal.throwIfAborted();
      return payload;
    };
    const sourceInput = (document: ExtractedDocument) => ({
      tenantId: job.tenantId,
      source: job.source,
      title: job.title ?? document.title,
      text: document.text,
      sections: document.sections,
      metadata: document.metadata,
    });
    const stage = async <T>(
      name: string,
      work: () => Promise<T>,
      details?: (value: T) => Record<string, unknown>,
    ) =>
      workflowNode(name, async () => {
        const started = performance.now();
        await this.jobs.recordEvent({
          jobId: job.id,
          tenantId: job.tenantId,
          stage: name,
          status: "started",
        });
        try {
          const result = await work();
          signal.throwIfAborted();
          await this.jobs.recordEvent({
            jobId: job.id,
            tenantId: job.tenantId,
            stage: name,
            status: "completed",
            durationMs: Math.round(performance.now() - started),
            details: details?.(result) ?? {},
          });
          return result;
        } catch (error) {
          await this.jobs
            .recordEvent({
              jobId: job.id,
              tenantId: job.tenantId,
              stage: name,
              status: "failed",
              durationMs: Math.round(performance.now() - started),
            })
            .catch(() => undefined);
          throw error;
        }
      });
    const finishNative = (state: typeof State.State) =>
      stage("text_quality", async () => ({
        document: this.extractor.completeNative
          ? await this.extractor.completeNative(
              state.native,
              { payload: await read(state.sourceHash) },
              undefined,
              signal,
            )
          : state.native,
      }));
    const builder = new StateGraph(State)
      .addNode("source_read", () =>
        stage(
          "source_read",
          async () => {
            const data = await read();
            return {
              sourceHash: createHash("sha256").update(data).digest("hex"),
              bytes: data.byteLength,
            };
          },
          (value) => ({ bytes: value.bytes }),
        ),
      )
      .addNode("text_extraction", (state) =>
        stage(
          "text_extraction",
          async () => ({
            native: this.extractor.extractNative
              ? await this.extractor.extractNative(
                  { ...job, payload: await read(state.sourceHash) },
                  signal,
                )
              : await this.extractor.extract(
                  { ...job, payload: await read(state.sourceHash) },
                  undefined,
                  signal,
                ),
          }),
          (value) => ({ characters: value.native.text.length }),
        ),
      )
      .addNode("quality_gate", (state) =>
        stage(
          "quality_gate",
          async () => ({
            needsOcr: Boolean(
              state.native.nativePages?.some(
                (page) => !hasReadableContent(page),
              ),
            ),
          }),
          (value) => ({ requiresOcr: value.needsOcr }),
        ),
      )
      .addNode("native_text", finishNative)
      .addNode("ocr_fallback", (state) =>
        workflowNode("ocr_fallback", async () => ({
          document: this.extractor.completeNative
            ? await this.extractor.completeNative(
                state.native,
                { payload: await read(state.sourceHash) },
                (event) =>
                  this.jobs.recordEvent({
                    jobId: job.id,
                    tenantId: job.tenantId,
                    ...event,
                  }),
                signal,
              )
            : state.native,
        })),
      )
      .addNode("metadata", (state) =>
        stage("metadata", async () => ({
          document: {
            ...state.document,
            metadata: {
              ...state.document.metadata,
              filename: job.filename,
              mimeType: job.mimeType,
              ingestionJobId: job.id,
              sourceSha256: state.sourceHash,
              sourceBytes: state.bytes,
            },
          },
        })),
      )
      .addNode("language", (state) =>
        stage(
          "language",
          async () => ({
            document: {
              ...state.document,
              metadata: {
                ...state.document.metadata,
                language: detectDocumentLanguage(state.document.text),
              },
            },
          }),
          (value) => ({ language: value.document.metadata.language }),
        ),
      )
      .addNode("structure", (state) =>
        stage(
          "structure",
          async () => ({
            document: {
              ...state.document,
              metadata: {
                ...state.document.metadata,
                sectionCount: state.document.sections?.length ?? 1,
              },
            },
          }),
          (value) => ({ sectionCount: value.document.metadata.sectionCount }),
        ),
      )
      .addNode("chunking", (state) =>
        stage(
          "chunking",
          async () => ({
            chunks: this.ingest.createChunks(sourceInput(state.document)),
          }),
          (value) => ({ chunkCount: value.chunks.length }),
        ),
      )
      .addNode("security_scan", (state) =>
        stage(
          "security_scan",
          async () => ({ scanned: this.ingest.scan(state.chunks) }),
          (value) => ({
            highRiskChunks: value.scanned.filter(
              ({ security }) => security.promptInjectionRisk === "high",
            ).length,
          }),
        ),
      )
      .addNode("embedding", (state) =>
        stage(
          "embedding",
          async () => ({
            embedded: await this.ingest.embed(
              job.tenantId,
              state.scanned,
              signal,
            ),
          }),
          (value) => ({ vectorCount: value.embedded.chunks.length }),
        ),
      )
      .addNode("persistence", (state) =>
        stage(
          "persistence",
          async () => ({
            result: {
              ...(await this.ingest.persist(
                sourceInput(state.document),
                state.embedded,
                signal,
              )),
              highRiskChunks: state.scanned.filter(
                ({ security }) => security.promptInjectionRisk === "high",
              ).length,
            },
          }),
          (value) => ({ documentId: value.result.id }),
        ),
      )
      .addNode("complete", (state) =>
        workflowNode("complete_ingestion", async () => {
          await this.jobs.complete(job.id, {
            documentId: state.result.id,
            chunkCount: state.result.chunkCount,
            highRiskChunks: state.result.highRiskChunks,
          });
          await this.cache.invalidateTenant(job.tenantId);
          await this.jobs.recordEvent({
            jobId: job.id,
            tenantId: job.tenantId,
            stage: "completed",
            status: "completed",
            details: {
              documentId: state.result.id,
              chunkCount: state.result.chunkCount,
              highRiskChunks: state.result.highRiskChunks,
            },
          });
          return {};
        }),
      )
      .addEdge(START, "source_read")
      .addEdge("source_read", "text_extraction")
      .addEdge("text_extraction", "quality_gate")
      .addConditionalEdges("quality_gate", (state) =>
        state.needsOcr ? "ocr_fallback" : "native_text",
      )
      .addEdge("native_text", "metadata")
      .addEdge("ocr_fallback", "metadata")
      .addEdge("metadata", "language")
      .addEdge("language", "structure")
      .addEdge("structure", "chunking")
      .addEdge("chunking", "security_scan")
      .addEdge("security_scan", "embedding")
      .addEdge("embedding", "persistence")
      .addEdge("persistence", "complete")
      .addEdge("complete", END);
    const execution = graphExecution(ingestionWorkflowVersion);
    const graph = builder.compile({ checkpointer: execution?.saver });
    const initial = { jobId: job.id, tenantId: job.tenantId };
    const input = execution
      ? await execution.input(initial, () => graph.getState(execution.config))
      : initial;
    const output = await graph.invoke(input, {
      ...execution?.config,
      signal,
      recursionLimit: 50,
    });
    return output.result;
  }
}
