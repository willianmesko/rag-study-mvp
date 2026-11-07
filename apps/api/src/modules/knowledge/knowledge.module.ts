import type { EmbeddingProvider, Reranker } from "../ai/index.js";
import type { IngestionJobRepository } from "../ingestion/index.js";
import type { DocumentRepository } from "./application/ports/document-repository.js";
import type { KnowledgeStatusRepository } from "./application/ports/knowledge-status-repository.js";
import type { DemoLibraryRepository } from "./application/ports/demo-library-repository.js";
import type { OriginalFileStore } from "./application/ports/original-file-store.js";
import { SearchDocumentsUseCase, type DocumentSearchOptions } from "./application/use-cases/search-documents.js";
import { GetDocumentOriginalUseCase } from "./application/use-cases/get-document-original.js";
import { DeleteDocumentUseCase } from "./application/use-cases/delete-document.js";

/** Assemble knowledge policies without selecting a database, storage or AI vendor. */
export function createKnowledgeServices(dependencies: {
  documents: DocumentRepository;
  knowledgeStatus: KnowledgeStatusRepository;
  demoLibraryRepository: DemoLibraryRepository;
  originals: OriginalFileStore;
  embeddings: EmbeddingProvider;
  reranker: Reranker;
  sourceJobs: Pick<IngestionJobRepository, "findIndexedOriginal" | "listStoragePathsForDocument" | "deleteForDocument">;
  searchOptions: DocumentSearchOptions;
}) {
  const { documents, knowledgeStatus, demoLibraryRepository, originals, embeddings, reranker, sourceJobs, searchOptions } = dependencies;
  return {
    documents,
    knowledgeStatus,
    demoLibraryRepository,
    originals,
    searchDocuments: new SearchDocumentsUseCase(embeddings, documents, reranker, searchOptions),
    getDocumentOriginal: new GetDocumentOriginalUseCase(sourceJobs, originals),
    deleteDocument: new DeleteDocumentUseCase(documents, sourceJobs, originals),
  };
}
