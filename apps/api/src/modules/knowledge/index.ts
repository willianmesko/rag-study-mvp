// Deliberate public contracts and capabilities; concrete composition stays in the module factory.
export { demoLibraries } from "./application/demo-libraries/catalog.js";
export { toLexicalQuery } from "./application/policies/lexical-query.js";
export { type DemoLibraryRepository } from "./application/ports/demo-library-repository.js";
export { type DocumentRepository } from "./application/ports/document-repository.js";
export { type OriginalFileStore } from "./application/ports/original-file-store.js";
export { type SearchDocumentsUseCase } from "./application/use-cases/search-documents.js";
export { chunkSections, chunkText, type DocumentSection } from "./domain/chunk.js";
export { type Citation, type DocumentInput, type EmbeddedChunk, type RetrievedChunk, type TextChunk } from "./domain/document.js";
export { restrictedPassagePreview } from "./http/passages.js";
