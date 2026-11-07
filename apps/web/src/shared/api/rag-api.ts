import type { z } from "zod";
import { decodeApiResponse, readJsonResponse } from "./api-response";
import { workspacesResponseSchema, workspaceCreatedResponseSchema, workspaceMembersResponseSchema, workspaceInvitationResponseSchema,
  healthResponseSchema, ingestResponseSchema, searchResponseSchema, questionResponseSchema, documentsResponseSchema, documentChunksResponseSchema,
  uploadsResponseSchema, uploadQueuedResponseSchema, ingestionEventsResponseSchema, ingestionPassagePreviewSchema, uploadCancelledResponseSchema,
  uploadRetriedResponseSchema, evaluationsResponseSchema, evaluationCreatedResponseSchema, workflowResponseSchema, conversationTurnResponseSchema } from "@rag-study/contracts";
import { usageResponseSchema } from "@rag-study/contracts";
import { ApiError, apiResponseError } from "./api-error";
export { ApiError } from "./api-error";
import { conversationPageSchema, conversationCreatedSchema, conversationMessagesSchema } from "@rag-study/contracts";
import { knowledgeStatusSchema } from "@rag-study/contracts";
import { chatModelCatalogSchema, demoLibraryCatalogSchema, demoSeedResponseSchema, questionComparisonResponseSchema, workspaceChatModelPolicyResponseSchema, workspaceOnboardingResponseSchema,
  mcpAccessIssuedSchema, mcpAccessStatusSchema, mcpConnectionsSchema, mcpConsentDetailsSchema, mcpConsentRedirectSchema, type McpReadToolName,
  type DocumentFilters, type QuestionComparisonInput, type WorkspaceChatModelPolicy, type WorkspaceOnboardingProgress } from "@rag-study/contracts";

export type { Health, SearchResult, SearchResponse, IngestResponse, QuestionResponse, QuestionSource,
  UploadJob, IngestionEvent, IngestionPassagePreview, ManagedDocument, StoredChunk, Workspace, WorkspaceMember,
  UsageSummary, EvaluationRun } from "@rag-study/contracts";
export type UsageAlert = import("@rag-study/contracts").UsageResponse["alert"];
type OriginalDocumentFile = { blob: Blob; filename: string; isPdf: boolean };

const apiBaseUrl = (import.meta.env.VITE_API_BASE_URL ?? "").replace(/\/$/, "");
const workspaceHeaders = (workspaceId?: string): Record<string, string> => workspaceId ? { "x-workspace-id": workspaceId } : {};

function originalFilename(disposition: string | null, fallback: string): string {
  const encoded = disposition?.match(/(?:^|;)\s*filename\*\s*=\s*UTF-8'[^']*'([^;]+)/i)?.[1];
  if (!encoded) return fallback;
  try {
    const filename = decodeURIComponent(encoded.trim()).replace(/[/\\\p{Cc}\u202a-\u202e\u2066-\u2069]/gu, "_").trim();
    return filename && filename !== "." && filename !== ".." ? filename : fallback;
  } catch {
    return fallback;
  }
}

async function request(path: string, init?: RequestInit): Promise<unknown> {
  const response = await fetch(`${apiBaseUrl}${path}`, {
    ...init,
    headers: {
      ...(init?.body ? { "content-type": "application/json" } : {}),
      ...init?.headers
    }
  });
  if (!response.ok) throw await apiResponseError(response);
  return readJsonResponse(response);
}

async function requestJson<T>(schema: z.ZodType<T>, path: string, init?: RequestInit): Promise<T> {
  return decodeApiResponse(schema, await request(path, init));
}

/** Explicitly selected metadata reads only. Search, streams, files and writes
 * retain their own provider/workflow budgets and cancellation semantics. */
async function readResourceJson<T>(schema: z.ZodType<T>, path: string,
  init?: Pick<RequestInit, "signal" | "headers" | "cache">): Promise<T> {
  const deadline = AbortSignal.timeout(10_000);
  return requestJson(schema, path, {
    ...init,
    signal: init?.signal ? AbortSignal.any([init.signal, deadline]) : deadline,
  });
}

async function requestVoid(path: string, init?: RequestInit): Promise<void> {
  const response = await fetch(`${apiBaseUrl}${path}`, {
    ...init,
    headers: { ...(init?.body ? { "content-type": "application/json" } : {}), ...init?.headers }
  });
  if (!response.ok) throw await apiResponseError(response);
}

async function waitForSavedTurn(token:string,workspaceId:string,saved:{conversationId:string;runId:string},signal:AbortSignal) {
  for(;;){
    signal.throwIfAborted();
    const turn=await api.conversationTurn(token,workspaceId,saved.conversationId,saved.runId,signal);
    if(turn.status!=='queued'&&turn.status!=='running')return turn;
    await new Promise<void>((resolve,reject)=>{
      const abort=()=>{clearTimeout(timer);reject(signal.reason);};
      const timer=setTimeout(()=>{signal.removeEventListener('abort',abort);resolve();},600);
      signal.addEventListener('abort',abort,{once:true});
    });
  }
}

export const api = {
  savedAnswer: async(input:QuestionInput,token:string,workspaceId:string,saved:{conversationId:string;runId:string},signal:AbortSignal,options:{recover?:boolean;onAccepted?:()=>void}={})=>{
    const bounded=AbortSignal.any([signal,AbortSignal.timeout(150000)]);
    if(!options.recover){
      await requestJson(conversationTurnResponseSchema, '/v1/qa/stream',{method:'POST',signal:bounded,body:JSON.stringify({...input,previousQuestions:undefined,...saved}),headers:{accept:'application/json',authorization:`Bearer ${token}`,...workspaceHeaders(workspaceId)}});
      options.onAccepted?.();
    }
    return waitForSavedTurn(token,workspaceId,saved,bounded);
  },
  savedComparison: async(input:QuestionComparisonInput,token:string,workspaceId:string,saved:{conversationId:string;runId:string},signal:AbortSignal,recover=false):Promise<import('@rag-study/contracts').QuestionComparisonResponse>=>{
    const bounded=AbortSignal.any([signal,AbortSignal.timeout(150000)]);
    if(!recover)await requestJson(conversationTurnResponseSchema, '/v1/qa/compare',{method:'POST',signal:bounded,body:JSON.stringify({...input,...saved}),headers:{authorization:`Bearer ${token}`,...workspaceHeaders(workspaceId)}});
    const turn=await waitForSavedTurn(token,workspaceId,saved,bounded);
    if(turn.comparison)return turn.comparison;
    throw new ApiError('The saved comparison did not complete.',409,'execution_failed');
  },
  conversations: async(token:string,workspaceId:string,signal:AbortSignal,cursor?:string)=>await readResourceJson(conversationPageSchema, `/v1/conversations?${new URLSearchParams({limit:'20',...(cursor?{cursor}:{})})}`, {
    signal,headers:{authorization:`Bearer ${token}`,...workspaceHeaders(workspaceId)}}),
  createConversation: async(token:string,workspaceId:string,id:string)=>await requestJson(conversationCreatedSchema, '/v1/conversations', {
    method:'POST',headers:{authorization:`Bearer ${token}`,...workspaceHeaders(workspaceId)},body:JSON.stringify({id}),signal:AbortSignal.timeout(15000)}),
  conversationMessages: async(token:string,workspaceId:string,id:string,signal:AbortSignal,before?:number,limit=25)=>await readResourceJson(conversationMessagesSchema, `/v1/conversations/${encodeURIComponent(id)}/messages?${new URLSearchParams({limit:String(limit),...(before?{before:String(before)}:{})})}`, {
    signal,headers:{authorization:`Bearer ${token}`,...workspaceHeaders(workspaceId)}}),
  renameConversation: async(token:string,workspaceId:string,id:string,title:string)=>await requestJson(conversationCreatedSchema, `/v1/conversations/${encodeURIComponent(id)}`, {
    method:'PATCH',headers:{authorization:`Bearer ${token}`,...workspaceHeaders(workspaceId)},body:JSON.stringify({title}),signal:AbortSignal.timeout(15000)}),
  deleteConversation: (token:string,workspaceId:string,id?:string)=>requestVoid(`/v1/conversations${id?`/${encodeURIComponent(id)}`:''}`,{
    method:'DELETE',headers:{authorization:`Bearer ${token}`,...workspaceHeaders(workspaceId)},signal:AbortSignal.timeout(15000)}),
  feedbackConversation: (token:string,workspaceId:string,id:string,messageId:string,value:'up'|'down'|null)=>requestVoid(`/v1/conversations/${encodeURIComponent(id)}/messages/${encodeURIComponent(messageId)}/feedback`,{
    method:'PUT',headers:{authorization:`Bearer ${token}`,'content-type':'application/json',...workspaceHeaders(workspaceId)},body:JSON.stringify({value}),signal:AbortSignal.timeout(15000)}),
  conversationTurn: async(token:string,workspaceId:string,id:string,runId:string,signal?:AbortSignal)=>(await readResourceJson(conversationTurnResponseSchema, `/v1/conversations/${encodeURIComponent(id)}/runs/${encodeURIComponent(runId)}`,{
    signal,headers:{authorization:`Bearer ${token}`,...workspaceHeaders(workspaceId)}})).turn,
  cancelConversationTurn: async(token:string,workspaceId:string,id:string,runId:string)=>(await requestJson(conversationTurnResponseSchema, `/v1/conversations/${encodeURIComponent(id)}/runs/${encodeURIComponent(runId)}/cancel`,{
    method:'POST',signal:AbortSignal.timeout(15000),headers:{authorization:`Bearer ${token}`,...workspaceHeaders(workspaceId)}})).turn,
  demoLibraries: async (token: string, workspaceId: string, locale: "en" | "pt-BR", signal: AbortSignal) => await requestJson(demoLibraryCatalogSchema, `/v1/demo-libraries?${new URLSearchParams({ locale })}`, {
      signal: AbortSignal.any([signal, AbortSignal.timeout(15_000)]), headers: { authorization: `Bearer ${token}`, ...workspaceHeaders(workspaceId) }
    }),
  seedDemoDocument: async (token: string, workspaceId: string, libraryId: string, documentKey: string, locale: "en" | "pt-BR", signal: AbortSignal) => await requestJson(demoSeedResponseSchema, `/v1/admin/demo-libraries/${encodeURIComponent(libraryId)}/documents/${encodeURIComponent(documentKey)}`, {
      method: "POST", body: JSON.stringify({ locale }), signal: AbortSignal.any([signal, AbortSignal.timeout(20_000)]),
      headers: { authorization: `Bearer ${token}`, ...workspaceHeaders(workspaceId) }
    }),
  workspaceMcpAccess: async (accessToken: string, workspaceId: string, signal: AbortSignal) => {
    try {
      return await requestJson(mcpAccessStatusSchema, "/v1/mcp/access", {
        signal: AbortSignal.any([signal, AbortSignal.timeout(10_000)]),
        headers: { authorization: `Bearer ${accessToken}`, ...workspaceHeaders(workspaceId) }
      });
    } catch (error) {
      if (error instanceof ApiError && error.status === 404) return null;
      throw error;
    }
  },
  issueWorkspaceMcpAccess: async (accessToken: string, workspaceId: string) => await requestJson(mcpAccessIssuedSchema, "/v1/mcp/access", {
      method: "POST", headers: { authorization: `Bearer ${accessToken}`, ...workspaceHeaders(workspaceId) },
      signal: AbortSignal.timeout(10_000)
    }),
  revokeWorkspaceMcpAccess: (accessToken: string, workspaceId: string) => requestVoid("/v1/mcp/access", {
    method: "DELETE", headers: { authorization: `Bearer ${accessToken}`, ...workspaceHeaders(workspaceId) },
    signal: AbortSignal.timeout(10_000)
  }),
  mcpConsent: async (token: string, id: string, signal: AbortSignal) => await readResourceJson(mcpConsentDetailsSchema, `/v1/mcp/oauth/requests/${encodeURIComponent(id)}`, {
    signal, headers: { authorization: `Bearer ${token}` }
  }),
  approveMcpConsent: async (token: string, workspaceId: string, id: string, tools: McpReadToolName[]) => await requestJson(mcpConsentRedirectSchema, `/v1/mcp/oauth/requests/${encodeURIComponent(id)}/approve`, {
    method: "POST", headers: { authorization: `Bearer ${token}`, ...workspaceHeaders(workspaceId) }, body: JSON.stringify({ tools })
  }),
  denyMcpConsent: async (token: string, id: string) => await requestJson(mcpConsentRedirectSchema, `/v1/mcp/oauth/requests/${encodeURIComponent(id)}/deny`, {
    method: "POST", headers: { authorization: `Bearer ${token}` }
  }),
  mcpConnections: async (token: string, workspaceId: string, signal: AbortSignal) => {
    try { return await readResourceJson(mcpConnectionsSchema, "/v1/mcp/connections", { signal, headers: { authorization: `Bearer ${token}`, ...workspaceHeaders(workspaceId) } }); }
    catch (error) { if (error instanceof ApiError && error.status === 404) return null; throw error; }
  },
  revokeMcpConnection: (token: string, workspaceId: string, id: string) => requestVoid(`/v1/mcp/connections/${encodeURIComponent(id)}`, {
    method: "DELETE", headers: { authorization: `Bearer ${token}`, ...workspaceHeaders(workspaceId) }
  }),
  workspaces: (accessToken: string, signal?: AbortSignal) => readResourceJson(workspacesResponseSchema, "/v1/workspaces", { signal, headers: { authorization: `Bearer ${accessToken}` } }),
  createWorkspace: (input: { name: string; slug: string; accessToken: string }) => requestJson(workspaceCreatedResponseSchema, "/v1/workspaces", { method: "POST", body: JSON.stringify({ name: input.name, slug: input.slug }), headers: { authorization: `Bearer ${input.accessToken}` } }),
  getOnboardingProgress: async (workspaceId: string, accessToken: string, signal: AbortSignal) => {
    const response = await requestJson(workspaceOnboardingResponseSchema, `/v1/workspaces/${workspaceId}/onboarding`, {
      headers: { authorization: `Bearer ${accessToken}`, ...workspaceHeaders(workspaceId) },
      signal: AbortSignal.any([signal, AbortSignal.timeout(10_000)])
    });
    return response.progress;
  },
  saveOnboardingProgress: async (workspaceId: string, accessToken: string, progress: WorkspaceOnboardingProgress) => {
    const response = await requestJson(workspaceOnboardingResponseSchema, `/v1/workspaces/${workspaceId}/onboarding`, {
      method: "PATCH", body: JSON.stringify(progress),
      headers: { authorization: `Bearer ${accessToken}`, ...workspaceHeaders(workspaceId) },
      signal: AbortSignal.timeout(10_000)
    });
    const saved = response.progress;
    if (!saved) throw new Error("The guide progress was not saved.");
    return saved;
  },
  listWorkspaceMembers: (workspaceId: string, accessToken: string, signal?: AbortSignal) => readResourceJson(workspaceMembersResponseSchema, `/v1/workspaces/${workspaceId}/members`, { signal, headers: { authorization: `Bearer ${accessToken}`, ...workspaceHeaders(workspaceId) } }),
  inviteWorkspaceMember: (input: { workspaceId: string; email: string; role: "editor" | "viewer"; accessToken: string; idempotencyKey?:string }) => requestJson(workspaceInvitationResponseSchema, `/v1/workspaces/${input.workspaceId}/invitations`, { method: "POST", body: JSON.stringify({ email: input.email, role: input.role }), headers: { authorization: `Bearer ${input.accessToken}`, ...workspaceHeaders(input.workspaceId), ...(input.idempotencyKey?{"idempotency-key":input.idempotencyKey}:{}) } }),
  changeWorkspaceMemberRole: (input: { workspaceId: string; userId: string; role: "editor" | "viewer"; accessToken: string }) => requestVoid(`/v1/workspaces/${input.workspaceId}/members/${input.userId}`, { method: "PATCH", body: JSON.stringify({ role: input.role }), headers: { authorization: `Bearer ${input.accessToken}`, ...workspaceHeaders(input.workspaceId) } }),
  removeWorkspaceMember: (input: { workspaceId: string; userId: string; accessToken: string }) => requestVoid(`/v1/workspaces/${input.workspaceId}/members/${input.userId}`, { method: "DELETE", headers: { authorization: `Bearer ${input.accessToken}`, ...workspaceHeaders(input.workspaceId) } }),
  health: (signal?: AbortSignal) => readResourceJson(healthResponseSchema, "/health", { signal }),
  knowledgeStatus: async (accessToken?: string | null, workspaceId?: string, signal?: AbortSignal) => await readResourceJson(knowledgeStatusSchema, "/v1/knowledge/status", { signal, headers: {
      ...(accessToken ? { authorization: `Bearer ${accessToken}` } : {}), ...workspaceHeaders(workspaceId)
    } }),
  ingest: (input: DocumentInput) =>
    requestJson(ingestResponseSchema, "/v1/documents", { method: "POST", body: JSON.stringify(input) }),
  search: (input: SearchInput & { accessToken?: string; workspaceId?: string }) =>
    requestJson(searchResponseSchema, `/v1/search?${new URLSearchParams({ q: input.query, topK: String(input.topK ?? 5) })}`, { headers: { ...(input.accessToken ? { authorization: `Bearer ${input.accessToken}` } : {}), ...workspaceHeaders(input.workspaceId) } }),
  answer: (input: QuestionInput & { accessToken?: string; workspaceId?: string; signal?: AbortSignal }) => requestJson(questionResponseSchema, "/v1/qa", {
    method: "POST", signal: input.signal,
    body: JSON.stringify({ question: input.question, topK: input.topK ?? 5, modelId: input.modelId, previousQuestions: input.previousQuestions }),
    headers: { ...(input.accessToken ? { authorization: `Bearer ${input.accessToken}` } : {}), ...workspaceHeaders(input.workspaceId) }
  }),
  chatModels: async (accessToken: string, workspaceId: string, signal: AbortSignal) => await requestJson(chatModelCatalogSchema, "/v1/qa/models", {
    headers: { authorization: `Bearer ${accessToken}`, ...workspaceHeaders(workspaceId) },
    signal: AbortSignal.any([signal, AbortSignal.timeout(10_000)])
  }),
  chatModelPolicy: async (accessToken: string, workspaceId: string, signal: AbortSignal) =>
    await readResourceJson(workspaceChatModelPolicyResponseSchema, "/v1/admin/chat-model-policy", {
      signal, headers: { authorization: `Bearer ${accessToken}`, ...workspaceHeaders(workspaceId) }
    }),
  saveChatModelPolicy: async (accessToken: string, workspaceId: string, policy: WorkspaceChatModelPolicy) =>
    await requestJson(workspaceChatModelPolicyResponseSchema, "/v1/admin/chat-model-policy", {
      method: "PATCH", body: JSON.stringify(policy), headers: { authorization: `Bearer ${accessToken}`, ...workspaceHeaders(workspaceId) }
    }),
  compareAnswers: async (input: QuestionComparisonInput, accessToken: string, workspaceId: string, signal: AbortSignal) =>
    await requestJson(questionComparisonResponseSchema, "/v1/qa/compare", {
      method: "POST", signal, body: JSON.stringify(input),
      headers: { authorization: `Bearer ${accessToken}`, ...workspaceHeaders(workspaceId) }
    }),
  listUploads: (accessToken: string, workspaceId?: string, signal?: AbortSignal) => readResourceJson(uploadsResponseSchema, "/v1/admin/uploads", { signal, headers: { authorization: `Bearer ${accessToken}`, ...(workspaceId ? { "x-workspace-id": workspaceId } : {}) } }),
  listUploadEvents: (jobId: string, accessToken: string, workspaceId?: string, signal?: AbortSignal) => readResourceJson(ingestionEventsResponseSchema, `/v1/admin/uploads/${jobId}/events`, { signal, headers: { authorization: `Bearer ${accessToken}`, ...workspaceHeaders(workspaceId) } }),
  previewUploadPassages: (jobId: string, accessToken: string, workspaceId: string, signal: AbortSignal) =>
    readResourceJson(ingestionPassagePreviewSchema, `/v1/admin/uploads/${encodeURIComponent(jobId)}/preview`, {
      headers: { authorization: `Bearer ${accessToken}`, "x-workspace-id": workspaceId }, signal, cache: "no-store"
    }),
  getUsageSummary: async (accessToken: string, workspaceId: string, days = 30, signal?: AbortSignal) => await readResourceJson(usageResponseSchema, `/v1/admin/usage?${new URLSearchParams({ days: String(days) })}`, { signal, headers: { authorization: `Bearer ${accessToken}`, ...workspaceHeaders(workspaceId) } }),
  listEvaluationRuns: (accessToken: string, workspaceId: string, signal?: AbortSignal) => readResourceJson(evaluationsResponseSchema, "/v1/admin/evaluations?limit=20", { signal, headers: { authorization: `Bearer ${accessToken}`, ...workspaceHeaders(workspaceId) } }),
  runEvaluation: (accessToken: string, workspaceId: string, options: { includeFaithfulness?: boolean; modelId?: string; effort?: "compact" | "standard" | "extended" } = {}) =>
    requestJson(evaluationCreatedResponseSchema, "/v1/admin/evaluations/run", {
      method: "POST", body: JSON.stringify(options), headers: { authorization: `Bearer ${accessToken}`, ...workspaceHeaders(workspaceId) }
    }),
  startEvaluationWorkflow: async (token:string,workspaceId:string,options: {includeFaithfulness?:boolean;modelId?:string;effort?:"compact"|"standard"|"extended"}) => {
    const result=await requestJson(workflowResponseSchema, "/v1/admin/evaluation-workflows",{method:"POST",body:JSON.stringify(options),headers:{authorization:`Bearer ${token}`,...workspaceHeaders(workspaceId)}});
    return result.workflow;
  },
  actOnEvaluationWorkflow: async (token:string,workspaceId:string,runId:string,action:"approve"|"cancel") => {
    const result=await requestJson(workflowResponseSchema, `/v1/admin/evaluation-workflows/${encodeURIComponent(runId)}/${action}`,{method:"POST",headers:{authorization:`Bearer ${token}`,...workspaceHeaders(workspaceId)}});
    return result.workflow;
  },
  cancelUpload: (jobId:string,token:string,workspaceId:string) => requestJson(uploadCancelledResponseSchema, `/v1/admin/uploads/${encodeURIComponent(jobId)}/cancel`,{method:"POST",headers:{authorization:`Bearer ${token}`,...workspaceHeaders(workspaceId)}}),
  retryUpload: (jobId: string, accessToken: string, workspaceId?: string) => requestJson(uploadRetriedResponseSchema, `/v1/admin/uploads/${jobId}/retry`, { method: "POST", headers: { authorization: `Bearer ${accessToken}`, ...workspaceHeaders(workspaceId) } }),
  listDocuments: (accessToken: string, workspaceId?: string, signal?: AbortSignal, filters: DocumentFilters = {}) => {
    const query = new URLSearchParams(Object.entries(filters).flatMap(([key, value]) => value === undefined ? [] : [[key, value]]));
    return readResourceJson(documentsResponseSchema, `/v1/admin/documents${query.size ? `?${query}` : ""}`, { signal, headers: { authorization: `Bearer ${accessToken}`, ...workspaceHeaders(workspaceId) } });
  },
  getOriginalDocument: async (input: { documentId: string; accessToken: string; workspaceId: string; signal: AbortSignal }): Promise<OriginalDocumentFile> => {
    const response = await fetch(`${apiBaseUrl}/v1/admin/documents/${encodeURIComponent(input.documentId)}/original`, {
      headers: { authorization: `Bearer ${input.accessToken}`, "x-workspace-id": input.workspaceId },
      signal: input.signal,
      cache: "no-store",
      redirect: "error"
    });
    if (!response.ok) throw new ApiError("The original file could not be loaded.", response.status);
    const contentType = response.headers.get("content-type")?.split(";")[0]?.trim().toLowerCase();
    const isPdf = contentType === "application/pdf";
    if (!isPdf && contentType !== "application/octet-stream") {
      throw new ApiError("The server returned an unexpected file format.", 502);
    }
    const filename = originalFilename(response.headers.get("content-disposition"), isPdf ? "original-file.pdf" : "original-file");
    return { blob: await response.blob(), filename, isPdf };
  },
  listDocumentChunks: (documentId: string, accessToken: string, workspaceId?: string, signal?: AbortSignal) => readResourceJson(documentChunksResponseSchema, `/v1/admin/documents/${documentId}/chunks`, { signal, headers: { authorization: `Bearer ${accessToken}`, ...workspaceHeaders(workspaceId) } }),
  reindexDocument: (documentId: string, accessToken: string, workspaceId?: string) => requestJson(uploadQueuedResponseSchema, `/v1/admin/documents/${documentId}/reindex`, { method: "POST", headers: { authorization: `Bearer ${accessToken}`, ...workspaceHeaders(workspaceId) } }),
  deleteDocument: (documentId: string, accessToken: string, workspaceId?: string) => requestVoid(`/v1/admin/documents/${documentId}`, { method: "DELETE", headers: { authorization: `Bearer ${accessToken}`, ...workspaceHeaders(workspaceId) } }),
  importDocumentUrl: (input: { url: string; title?: string; accessToken: string; workspaceId: string }) =>
    requestJson(uploadQueuedResponseSchema, "/v1/admin/uploads/url", {
      method: "POST",
      headers: { authorization: `Bearer ${input.accessToken}`, "x-workspace-id": input.workspaceId },
      body: JSON.stringify({ url: input.url, title: input.title })
    }),
  uploadDocument: async (input: { file: File; source: string; title?: string; accessToken: string; workspaceId?: string; signal?: AbortSignal }) => {
    const body = new FormData(); body.append("file", input.file);
    const response = await fetch(`${apiBaseUrl}/v1/admin/uploads`, { method: "POST", body, signal: input.signal, headers: { authorization: `Bearer ${input.accessToken}`, ...workspaceHeaders(input.workspaceId), "x-document-source": input.source, ...(input.title ? { "x-document-title": input.title } : {}) } });
    if (!response.ok) throw await apiResponseError(response, "The file could not be uploaded.");
    return decodeApiResponse(uploadQueuedResponseSchema, await readJsonResponse(response));
  }
};

import type { DocumentInput, QuestionInput, QuestionResponse, SearchInput } from "@rag-study/contracts";

