// Deliberate public contracts and capabilities; concrete composition stays in the module factory.
export { type IngestionJob, type IngestionJobRepository } from "./application/ports/ingestion-job-repository.js";
export { type ReindexDocumentUseCase } from "./application/use-cases/reindex-document.js";
