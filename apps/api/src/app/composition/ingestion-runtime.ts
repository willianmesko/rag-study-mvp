import { IngestDocumentUseCase } from "../../modules/ingestion/application/use-cases/ingest-document.js";
import { ProcessNextIngestionJobUseCase } from "../../modules/ingestion/application/use-cases/process-next-ingestion-job.js";
import { QueueDocumentUploadUseCase } from "../../modules/ingestion/application/use-cases/queue-document-upload.js";
import { ReindexDocumentUseCase } from "../../modules/ingestion/application/use-cases/reindex-document.js";
import { RetryIngestionJobUseCase } from "../../modules/ingestion/application/use-cases/retry-ingestion-job.js";
import { MultiFormatDocumentTextExtractor } from "../../modules/ingestion/infrastructure/extraction/document-text-extractor.js";
import { PopplerTesseractOcr } from "../../modules/ingestion/infrastructure/extraction/pdf-ocr.js";
import { HttpsPublicHtmlFetcher } from "../../modules/ingestion/infrastructure/extraction/public-html-fetcher.js";
import { createIngestionWorkflow } from "../../modules/ingestion/ingestion.module.js";
import type { RuntimeConfiguration } from "../configuration/environment.js";
import type { AiRuntime } from './ai-runtime.js';
import type { CoreRuntime } from './core-runtime.js';
import { createIngestionWorkflowAdapter, ingestionWorkflowOptionsFromConfiguration } from "./ingestion-workflow.js";
import type { KnowledgeRuntime } from './knowledge-runtime.js';
import type { WorkflowsRuntime } from './workflows-runtime.js';
export function createIngestionRuntime(config: RuntimeConfiguration, core: CoreRuntime, ai: AiRuntime, knowledge: KnowledgeRuntime, workflows: WorkflowsRuntime) {
    const { jobs, originals, engine, semanticCache } = core;
    const { embeddings } = ai;
    const { documents } = knowledge;
    const { embeddingVersion } = workflows;
    const ingestDocument = new IngestDocumentUseCase(embeddings, documents, {
        chunkSize: config.CHUNK_SIZE,
        chunkOverlap: config.CHUNK_OVERLAP,
        embeddingConcurrency: 3,
    });
    const extractor = new MultiFormatDocumentTextExtractor({
        ocr: config.PDF_OCR_ENABLED
            ? new PopplerTesseractOcr({
                languages: config.PDF_OCR_LANGUAGES,
                timeoutMs: config.PDF_OCR_TIMEOUT_MS,
            })
            : undefined,
        maxOcrPages: config.PDF_OCR_MAX_PAGES,
    });
    const enqueueIngestion = createIngestionWorkflow({
        jobs, engine, embeddingVersion,
        workflow: createIngestionWorkflowAdapter({ jobs, extractor, ingestDocument, originals, semanticCache }),
        options: ingestionWorkflowOptionsFromConfiguration(config),
    });
    const queueDocumentUpload = new QueueDocumentUploadUseCase(jobs, originals, config.DAILY_ADMIN_UPLOAD_BYTES_LIMIT);
    const publicHtmlFetcher = new HttpsPublicHtmlFetcher({
        maxBytes: Math.min(config.UPLOAD_MAX_BYTES, 1000000),
        timeoutMs: 10000,
    });
    const processNextIngestionJob = new ProcessNextIngestionJobUseCase(jobs, extractor, ingestDocument, originals, semanticCache, enqueueIngestion);
    const retryIngestionJob = new RetryIngestionJobUseCase(jobs);
    const reindexDocument = new ReindexDocumentUseCase(jobs);
    return { ingestDocument, extractor, enqueueIngestion, queueDocumentUpload, publicHtmlFetcher, processNextIngestionJob, retryIngestionJob, reindexDocument };
}
export type IngestionRuntime = ReturnType<typeof createIngestionRuntime>;
