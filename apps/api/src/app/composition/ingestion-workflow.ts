import type { DocumentTextExtractor } from "../../modules/ingestion/application/ports/document-text-extractor.js";
import type { IngestionJobRepository } from "../../modules/ingestion/application/ports/ingestion-job-repository.js";
import type { IngestionWorkflow, IngestionWorkflowOptions } from "../../modules/ingestion/application/ports/ingestion-workflow.js";
import type { RuntimeConfiguration } from "../configuration/environment.js";
import type { IngestDocumentUseCase } from "../../modules/ingestion/application/use-cases/ingest-document.js";
import type { OriginalFileStore } from "../../modules/knowledge/index.js";
import type { SemanticAnswerCache } from "../../modules/chat/index.js";
import { LangGraphIngestionWorkflow, ingestionWorkflowVersion } from "../../modules/ingestion/infrastructure/langgraph/langgraph-ingestion-workflow.js";

export function ingestionWorkflowOptionsFromConfiguration(configuration: RuntimeConfiguration): IngestionWorkflowOptions {
  return {
    chunkSize: configuration.CHUNK_SIZE,
    chunkOverlap: configuration.CHUNK_OVERLAP,
    ocrEnabled: configuration.PDF_OCR_ENABLED,
    ocrLanguages: configuration.PDF_OCR_LANGUAGES,
    ocrMaxPages: configuration.PDF_OCR_MAX_PAGES,
    ocrTimeoutMs: configuration.PDF_OCR_TIMEOUT_MS,
    maxCostUsd: configuration.WORKFLOW_INGEST_MAX_COST_USD,
  };
}

export function createIngestionWorkflowAdapter(dependencies: {
  jobs: IngestionJobRepository;
  extractor: DocumentTextExtractor;
  ingestDocument: IngestDocumentUseCase;
  originals: OriginalFileStore;
  semanticCache: SemanticAnswerCache;
}): IngestionWorkflow {
  const { jobs, extractor, ingestDocument, originals, semanticCache } = dependencies;
  const workflow = new LangGraphIngestionWorkflow(jobs, extractor, ingestDocument, originals, semanticCache);
  return { version: ingestionWorkflowVersion, execute: workflow.execute.bind(workflow) };
}
