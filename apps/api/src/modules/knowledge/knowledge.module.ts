import type { Pool } from "pg";
import { PgDocumentRepository } from "./infrastructure/postgres/pg-document-repository.js";
import { PgKnowledgeStatusRepository } from "./infrastructure/postgres/pg-knowledge-status-repository.js";
import { PgDemoLibraryRepository } from "./infrastructure/postgres/pg-demo-library-repository.js";
import { SupabaseOriginalFileStore } from "./infrastructure/storage/supabase-original-file-store.js";

/** Keep document providers and private originals in one feature assembly. */
export function createKnowledgeServices(pool: Pool, options: {
  embeddingDimensions: number;
  supabaseUrl?: string;
  serviceRoleKey?: string;
  uploadBucket: string;
}) {
  return {
    documents: new PgDocumentRepository(pool, options.embeddingDimensions),
    knowledgeStatus: new PgKnowledgeStatusRepository(pool),
    demoLibraryRepository: new PgDemoLibraryRepository(pool),
    originals: new SupabaseOriginalFileStore(options.supabaseUrl, options.serviceRoleKey, options.uploadBucket),
  };
}
