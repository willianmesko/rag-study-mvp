import type { ChatRunRepository } from "./chat-run-repository.js";
import type { ConversationRepository } from "./conversation-repository.js";
import type { SemanticAnswerCache } from "./semantic-answer-cache.js";
import type { WorkspaceModelPolicyRepository } from "./workspace-model-policy-repository.js";

export type ChatStorage = {
  chatRuns: ChatRunRepository;
  conversations: ConversationRepository;
  semanticCache: SemanticAnswerCache;
  workspaceModelPolicies: WorkspaceModelPolicyRepository;
};
