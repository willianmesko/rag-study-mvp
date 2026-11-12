import type { WorkspaceModelPolicyRepository } from "../../modules/chat/application/ports/workspace-model-policy-repository.js";
import type { Pool } from "pg";
import type { ChatStorage } from "../../modules/chat/application/ports/chat-storage.js";
import { PgChatRunRepository } from "../../modules/chat/infrastructure/postgres/pg-chat-run-repository.js";
import { PgConversationRepository } from "../../modules/chat/infrastructure/postgres/pg-conversation-repository.js";
import { PgSemanticAnswerCache } from "../../modules/chat/infrastructure/postgres/pg-semantic-answer-cache.js";
import { PgWorkspaceModelPolicyRepository } from "../../modules/chat/infrastructure/postgres/pg-workspace-model-policy-repository.js";

/** Storage adapters borrow the root pool; the application owns its lifecycle. */
export function createChatStorage(pool: Pool, embeddingDimensions: number, workspaceModelPolicies?: WorkspaceModelPolicyRepository): ChatStorage {
  return {
    chatRuns: new PgChatRunRepository(pool),
    conversations: new PgConversationRepository(pool),
    semanticCache: new PgSemanticAnswerCache(pool, embeddingDimensions),
    workspaceModelPolicies: workspaceModelPolicies ?? new PgWorkspaceModelPolicyRepository(pool),
  };
}
