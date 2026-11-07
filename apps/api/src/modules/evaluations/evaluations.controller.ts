import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { chatModelIdSchema } from "@rag-study/contracts";
import { evaluationEffortSchema } from "./application/evaluation/evaluation-effort.js";
import type { WorkspaceWorkflows } from "../workflows/index.js";
import type { DemoLibraryRepository } from "../knowledge/index.js";
import type { EvaluationRun } from "./application/ports/evaluation-repository.js";
import type { AuditEventRepository } from "../usage/index.js";
import type { RunEvaluationUseCase } from "./application/use-cases/run-evaluation.js";
import { modelUnavailable, type ChatModelSelection } from "../chat/index.js";
import { rejectScope, type WorkspaceAuthorizer } from "../../platform/http/workspace-authorization.js";
import { serializeEvaluationRun, serializeWorkflow } from "./http/evaluations.js";

const evaluationInput = z.strictObject({ includeFaithfulness: z.boolean().optional(), modelId: chatModelIdSchema.optional(), effort: evaluationEffortSchema.optional() });
type EvaluationWorkflows = Pick<WorkspaceWorkflows, "startEvaluation" | "approve" | "cancel"> & {
  repository: Pick<WorkspaceWorkflows["repository"], "list" | "get">;
};
export type EvaluationRoutesDependencies = {
  authorizeOwner: WorkspaceAuthorizer;
  models: ChatModelSelection;
  workflows?: EvaluationWorkflows;
  demoLibraryRepository?: Pick<DemoLibraryRepository, "sourceStates">;
  listEvaluationRuns: (tenantId: string, limit: number) => Promise<EvaluationRun[]>;
  runEvaluation: Pick<RunEvaluationUseCase, "execute" | "supportsFaithfulness">;
  recordAuditEvent: AuditEventRepository["record"];
};
export const evaluationRoutes: FastifyPluginAsync<EvaluationRoutesDependencies> = async (app, dependencies) => {
  const { authorizeOwner } = dependencies;
  const { workspaceChatModels } = dependencies.models;
  app.get("/v1/admin/evaluations", async (request, reply) => {
    const authorization = await authorizeOwner(request);
    if (!authorization.ok) return rejectScope(reply, authorization);
    const { limit } = z.object({ limit: z.coerce.number().int().min(1).max(50).default(20) }).parse(request.query);
    const reference = (await dependencies.demoLibraryRepository?.sourceStates(authorization.tenantId, ["golden/rag-fundamentals"]))?.[0];
    return { workflowAvailable: Boolean(dependencies.workflows), workflows: dependencies.workflows ? (await dependencies.workflows.repository.list(authorization.tenantId, "evaluation", limit)).map(serializeWorkflow) : [], runs: (await dependencies.listEvaluationRuns(authorization.tenantId, limit)).map(serializeEvaluationRun), faithfulnessEnabled: dependencies.runEvaluation.supportsFaithfulness,
      ...(reference ? { reference: { ...reference, ready: reference.state === "ready" } } : {}) };
  });
  app.post("/v1/admin/evaluations/run", { config: { rateLimit: { max: 2 } } }, async (request, reply) => {
    const authorization = await authorizeOwner(request);
    if (!authorization.ok) return rejectScope(reply, authorization);
    const input = evaluationInput.parse(request.body ?? {});
    if (dependencies.workflows) return reply.code(409).send({code:"durable_evaluation_required",error:"Start a durable evaluation from the evaluation center."});
    if (input.modelId && !(await workspaceChatModels(authorization.tenantId)).models.has(input.modelId)) return reply.code(400).send(modelUnavailable);
    return reply.code(201).send({ run: serializeEvaluationRun(await dependencies.runEvaluation.execute({ tenantId: authorization.tenantId, ...input })) });
  });
  app.post("/v1/admin/evaluation-workflows", { config: { rateLimit: { max: 2 } } }, async (request,reply) => {
    const owner = await authorizeOwner(request,true); if (!owner.ok) return rejectScope(reply,owner);
    if (!request.headers['x-workspace-id']) return reply.code(400).send({code:'workspace_required',error:'Select a workspace.'});
    if (!dependencies.workflows) return reply.code(503).send({error:'Durable evaluations are not enabled.'});
    return reply.code(202).send({workflow:serializeWorkflow(await dependencies.workflows.startEvaluation(owner.tenantId,owner.userId,evaluationInput.parse(request.body ?? {})))});
  });
  app.post("/v1/admin/evaluation-workflows/:runId/:action", async (request,reply) => {
    const owner = await authorizeOwner(request,true); if (!owner.ok) return rejectScope(reply,owner);
    if (!request.headers['x-workspace-id']) return reply.code(400).send({code:'workspace_required',error:'Select a workspace.'});
    const {runId,action} = z.strictObject({runId:z.string().uuid(),action:z.enum(['approve','cancel'])}).parse(request.params);
    if (!dependencies.workflows) return reply.code(503).send({error:'Durable evaluations are not enabled.'});
    const runs = await dependencies.workflows.repository.list(owner.tenantId,'evaluation',50);
    const run = runs.find((item)=>item.runId===runId); if (!run) return reply.code(404).send({error:'Evaluation not found.'});
    const scope = {tenantId:owner.tenantId,actorId:run.actorId,runId};
    const changed = action === 'approve' ? await dependencies.workflows.approve(scope,owner.userId) : await dependencies.workflows.cancel(scope);
    if (!changed) return reply.code(409).send({error:'This evaluation has already changed. Refresh to see its status.'});
    await dependencies.recordAuditEvent({tenantId:owner.tenantId,actorUserId:owner.userId,action:`workflow.${action}`,resourceType:'evaluation',resourceId:runId,requestId:request.id,metadata:{}});
    return {workflow:serializeWorkflow((await dependencies.workflows.repository.get(scope))!)};
  });
};
