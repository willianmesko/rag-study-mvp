import { questionComparisonResponseSchema } from "@rag-study/contracts";
import { ConversationError, type ConversationRepository } from "../application/ports/conversation-repository.js";
import type { ChatRunRepository } from "../application/ports/chat-run-repository.js";
import { ConversationDelivery } from "../application/conversations/delivery.js";
import type { CompareAnswersUseCase } from "../application/use-cases/compare-answers.js";
import type { StreamAnswerRuns } from "../application/use-cases/stream-answer-runs.js";
import type { WorkspaceWorkflows } from "../../workflows/index.js";
import type { ChatModelSelection, QuestionQuotaConsumer } from "./chat-models.js";
import { serializeQuestionAnswer, serializeWorkflowEvent } from "./answers.js";

export function createChatDelivery(dependencies: {
  conversations?: ConversationRepository;
  chatRuns: ChatRunRepository;
  workflows?: Pick<WorkspaceWorkflows, "startChat">;
  compareAnswers: Pick<CompareAnswersUseCase, "execute">;
  consumeQuestionQuota: QuestionQuotaConsumer;
  answerRuns: Pick<StreamAnswerRuns, "start">;
  models: ChatModelSelection;
  shutdown: AbortSignal;
  timeoutMs: number;
  report: (code: string, message: string) => void;
}) {
  const records = dependencies.conversations;
  if (!records) return undefined;
  const { workspaceChatModels, chooseAnswer } = dependencies.models;
  const { answerRuns } = dependencies;
  return new ConversationDelivery(records,dependencies.chatRuns,
    async (submission) => {
      const {tenantId,userId,runId,conversationId,input}=submission;
      if(!await records.turn(submission,runId))throw new ConversationError('conversation_unavailable',404);
      const scope={tenantId,actorId:userId,runId,conversationId},actorKey=`user:${userId}`;
      if(dependencies.workflows){await dependencies.workflows.startChat(scope,input);return;}
      const answer=await chooseAnswer(tenantId,input.modelId);
      if(!answer)throw new ConversationError('conversation_unavailable',409);
      await answerRuns.start(scope,{ reserveQuota:async()=>(await dependencies.consumeQuestionQuota(tenantId,actorKey)).allowed,
        answer:async({signal,publish})=>serializeQuestionAnswer(await answer({...input,tenantId,actorKey,bypassCache:true,signal,onEvent:(event)=>publish(serializeWorkflowEvent(event))})),
        reportFailure:()=>dependencies.report('saved_answer_failed','Saved answer execution failed') });
    },async(submission,signal)=>{
      const profile=await workspaceChatModels(submission.tenantId),[left,right]=submission.input.modelIds.map((id)=>profile.models.get(id));
      if(!left||!right)throw new ConversationError('conversation_unavailable',409);
      const quota=await dependencies.consumeQuestionQuota(submission.tenantId,`user:${submission.userId}`,2);
      if(!quota.allowed)throw new ConversationError('conversation_limit',429);
      const results=await dependencies.compareAnswers.execute({...submission.input,tenantId:submission.tenantId,actorKey:`user:${submission.userId}`,models:[left,right],signal});
      return questionComparisonResponseSchema.parse({results:results.map(({model,response,...result})=>({...result,model,response:response?serializeQuestionAnswer(response,model):null}))});
    },dependencies.shutdown,dependencies.timeoutMs,(reason)=>dependencies.report(reason,'Conversation delivery could not complete'));
}
