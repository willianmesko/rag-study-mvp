import { randomUUID } from "node:crypto";
import { z } from "zod";
import {
  questionInputSchema,
  type QuestionInput,
  type ChatRunEvent,
  type QuestionResponse,
} from "@rag-study/contracts";
import type { TenantMembership } from "../ports/tenant-membership-repository.js";
import type { ChatRunScope } from "../ports/chat-run-repository.js";
import type { AnswerQuestionUseCase } from "../use-cases/answer-question.js";
import type { RunEvaluationUseCase } from "../use-cases/run-evaluation.js";
import { evaluationEffortSchema } from "../evaluation/evaluation-effort.js";
import { preparePreviousQuestions } from "../policies/conversation-context.js";
import {
  publicAnswerResponse,
  publicWorkflowEvent,
} from "../policies/answer-response.js";
import { redactPii } from "../../domain/security/pii-redaction.js";
import {
  WorkflowGuardError,
  type WorkflowEngine,
  type WorkflowBudget,
  type WorkflowScope,
} from "./types.js";

const chatInput = z.strictObject({
  turn: questionInputSchema,
  signature: z.string(),
  indexVersion: z.string(),
});
export const evaluationWorkflowInput = z.strictObject({
  includeFaithfulness: z.boolean().default(false),
  modelId: z.string().optional(),
  effort: evaluationEffortSchema.default("standard"),
});
const evaluationInput = z.strictObject({
  options: evaluationWorkflowInput,
  signature: z.string(),
  indexVersion: z.string(),
});
type Resolved = {
  modelId: string;
  signature: string;
  execute: (
    input: Parameters<AnswerQuestionUseCase["execute"]>[0],
  ) => Promise<
    import("../ports/question-answering-workflow.js").AnswerQuestionResult
  >;
};
type Dependencies = {
  engine: WorkflowEngine;
  chatVersion: string;
  evaluationVersion: string;
  chatBudget: WorkflowBudget;
  evaluationBudget: WorkflowBudget;
  member: (
    userId: string,
    tenantId: string,
  ) => Promise<TenantMembership | null>;
  resolveChat: (tenantId: string, modelId?: string) => Promise<Resolved | null>;
  embeddingVersion: (tenantId: string) => Promise<string>;
  consumeQuota: (tenantId: string, actorKey: string) => Promise<boolean>;
  runChat: (
    scope: ChatRunScope,
    work: {
      reserveQuota: () => Promise<boolean>;
      answer: (
        signal: AbortSignal,
        publish: (event: ChatRunEvent) => Promise<void>,
      ) => Promise<QuestionResponse>;
    },
    signal: AbortSignal,
  ) => Promise<void>;
  runEvaluation: RunEvaluationUseCase;
};

/** Admission stores an immutable approved plan, not a session token or browser-chosen provider identifier. */
export class WorkspaceWorkflows {
  constructor(private readonly deps: Dependencies) {
    const { engine } = deps;
    engine.register("chat", {
      version: deps.chatVersion,
      authorize: async (lease) => {
        const input = chatInput.parse(lease.input);
        return (
          Boolean(await deps.member(lease.actorId, lease.tenantId)) &&
          (await this.matches(
            lease.tenantId,
            input.turn.modelId,
            input.signature,
            input.indexVersion,
          ))
        );
      },
      run: async (lease, signal) => {
        const { turn } = chatInput.parse(lease.input),
          answer = await deps.resolveChat(lease.tenantId, turn.modelId);
        if (!answer) throw new WorkflowGuardError("authorization_revoked");
        await deps.runChat(
          lease,
          {
            reserveQuota: () =>
              deps.consumeQuota(lease.tenantId, `user:${lease.actorId}`),
            answer: async (signal, publish) =>
              publicAnswerResponse(
                await answer.execute({
                  ...turn,
                  tenantId: lease.tenantId,
                  actorKey: `user:${lease.actorId}`,
                  bypassCache: Boolean(lease.conversationId),
                  signal,
                  onEvent: (event) => publish(publicWorkflowEvent(event)),
                }),
              ),
          },
          signal,
        );
        return {};
      },
    });
    engine.register("evaluation", {
      version: deps.evaluationVersion,
      authorize: async (lease) => {
        const input = evaluationInput.parse(lease.input),
          member = await deps.member(lease.actorId, lease.tenantId);
        if (member?.role !== "owner") return false;
        if (
          lease.approvedBy &&
          (await deps.member(lease.approvedBy, lease.tenantId))?.role !==
            "owner"
        )
          return false;
        return this.matches(
          lease.tenantId,
          input.options.modelId,
          input.signature,
          input.indexVersion,
        );
      },
      run: async (lease, signal) => {
        const { options } = evaluationInput.parse(lease.input);
        const result = await deps.runEvaluation.execute({
          tenantId: lease.tenantId,
          ...options,
          signal,
        });
        return { resultId: result.id };
      },
    });
  }
  get repository() {
    return this.deps.engine.repository;
  }
  start() {
    this.deps.engine.start();
  }
  close() {
    return this.deps.engine.close();
  }
  cancel(scope: WorkflowScope) {
    return this.deps.engine.cancel(scope);
  }
  private async matches(
    tenantId: string,
    modelId: string | undefined,
    signature: string,
    indexVersion: string,
  ) {
    const current = await this.deps.resolveChat(tenantId, modelId);
    return (
      current?.signature === signature &&
      (await this.deps.embeddingVersion(tenantId)) === indexVersion
    );
  }
  async startChat(scope: WorkflowScope, input: QuestionInput) {
    if (!(await this.deps.member(scope.actorId, scope.tenantId)))
      throw new WorkflowGuardError("authorization_revoked");
    const requested = questionInputSchema.parse(input);
    const resolved = await this.deps.resolveChat(
      scope.tenantId,
      requested.modelId,
    );
    if (!resolved) throw new WorkflowGuardError("definition_changed");
    const previousQuestions = preparePreviousQuestions(
      requested.previousQuestions,
    );
    const turn = {
      ...requested,
      question: redactPii(requested.question).text,
      modelId: resolved.modelId,
      previousQuestions: previousQuestions.length
        ? previousQuestions
        : undefined,
    };
    return this.deps.engine.submit({
      ...scope,
      kind: "chat",
      version: this.deps.chatVersion,
      input: {
        turn,
        signature: resolved.signature,
        indexVersion: await this.deps.embeddingVersion(scope.tenantId),
      },
      budget: this.deps.chatBudget,
    });
  }
  async startEvaluation(tenantId: string, actorId: string, input: unknown) {
    if ((await this.deps.member(actorId, tenantId))?.role !== "owner")
      throw new WorkflowGuardError("authorization_revoked");
    const options = evaluationWorkflowInput.parse(input),
      resolved = await this.deps.resolveChat(tenantId, options.modelId);
    if (!resolved) throw new WorkflowGuardError("definition_changed");
    if (resolved.modelId === "auto")
      throw new WorkflowGuardError("definition_changed");
    await this.deps.runEvaluation.preflight({ tenantId, ...options });
    options.modelId = resolved.modelId;
    return this.deps.engine.submit({
      tenantId,
      actorId,
      runId: randomUUID(),
      kind: "evaluation",
      version: this.deps.evaluationVersion,
      input: {
        options,
        signature: resolved.signature,
        indexVersion: await this.deps.embeddingVersion(tenantId),
      },
      budget: this.deps.evaluationBudget,
    });
  }
  async approve(scope: WorkflowScope, userId: string) {
    if ((await this.deps.member(userId, scope.tenantId))?.role !== "owner")
      throw new WorkflowGuardError("authorization_revoked");
    return this.repository.approve(scope, userId);
  }
}
