import { QueryClient } from "@tanstack/react-query";
import { expect, test } from "@playwright/test";
import type { z } from "zod";
import {
  workspacesResponseSchema, workspaceCreatedResponseSchema, workspaceMembersResponseSchema, workspaceInvitationResponseSchema,
  searchResponseSchema, ingestResponseSchema, documentsResponseSchema, documentChunksResponseSchema,
  uploadsResponseSchema, uploadQueuedResponseSchema, ingestionEventsResponseSchema, ingestionPassagePreviewSchema,
  uploadCancelledResponseSchema, uploadRetriedResponseSchema, evaluationsResponseSchema, evaluationCreatedResponseSchema,
} from "../../packages/contracts/src/index";
import { decodeApiResponse, readJsonResponse } from "../../apps/web/src/shared/api/api-response";
import { workspaceFixture } from "./workspace-fixture";

const date = "2026-11-07T12:00:00.000Z";
const workspaceId = "11111111-1111-4111-a111-111111111111";
const userId = "22222222-2222-4222-a222-222222222222";
const workspace = { tenantId: workspaceId, tenantName: "Contract workspace", tenantSlug: "contract-workspace", role: "owner" };
const member = { userId, email: "owner@example.test", role: "owner", createdAt: date };
const document = { id: "sample-document", source: "sample.md", title: "Contract sample", chunkCount: 2, createdAt: date, updatedAt: date };
const security = { promptInjectionRisk: "low", signals: [] };
const chunk = { id: "sample-passage", ordinal: 0, content: "Reviewed passage.", security, createdAt: date };
const search = { chunkId: chunk.id, documentId: document.id, ordinal: 0, content: "Reviewed passage.", source: document.source, title: document.title, score: 0.8, security };
const job = { id: "sample-upload", source: document.source, title: document.title, filename: "sample.md", mimeType: "text/markdown", status: "completed", progress: 100, error: null, chunkCount: 2, highRiskChunks: 0, createdAt: date, updatedAt: date };
const event = { id: "sample-event", stage: "chunking", status: "completed", durationMs: 12.5, details: { chunkCount: 2 }, createdAt: date };
const preview = { totalChunks: 2, passages: [{ chunkId: chunk.id, chunk: 0, excerpt: "Reviewed passage.", excerptTruncated: false, previewBlocked: false }] };
const evaluation = { id: "sample-evaluation", tenantId: workspaceId, datasetName: "Public reference", datasetVersion: "1.0", commitSha: null, embeddingProvider: "fixture", embeddingModel: "fixture-embedding", chatProvider: "fixture", chatModel: "fixture-chat", totalCases: 4, hitRate: 1, meanReciprocalRank: 1, faithfulness: null, contextPrecision: null, injectionPassRate: 1, passed: true, durationMs: 12, failureDetails: {}, createdAt: date };

const contractCases: Array<{ name: string; schema: z.ZodType; valid: Record<string, unknown>; invalid: Record<string, unknown> }> = [
  { name: "workspaces", schema: workspacesResponseSchema, valid: { workspaces: [workspace] }, invalid: { workspaces: [{ ...workspace, role: "administrator" }] } },
  { name: "created workspace", schema: workspaceCreatedResponseSchema, valid: { workspace }, invalid: { workspace: { ...workspace, tenantId: "not-a-workspace-uuid" } } },
  { name: "members", schema: workspaceMembersResponseSchema, valid: { members: [member, { ...member, email: null }] }, invalid: { members: [{ ...member, role: "superuser" }] } },
  { name: "invitation receipt", schema: workspaceInvitationResponseSchema, valid: { member: { userId, email: null, role: "viewer" } }, invalid: { member: { userId, email: 123, role: "viewer" } } },
  { name: "search", schema: searchResponseSchema, valid: { results: [search] }, invalid: { results: [{ ...search, score: "0.8" }] } },
  { name: "direct ingestion", schema: ingestResponseSchema, valid: { documentId: document.id, chunkCount: 2, highRiskChunks: 0 }, invalid: { documentId: document.id, chunkCount: -1, highRiskChunks: 0 } },
  { name: "documents", schema: documentsResponseSchema, valid: { documents: [document] }, invalid: { documents: [{ ...document, updatedAt: "not-a-date" }] } },
  { name: "chunks", schema: documentChunksResponseSchema, valid: { chunks: [chunk] }, invalid: { chunks: [{ ...chunk, security: { promptInjectionRisk: "trusted", signals: [] } }] } },
  { name: "upload list", schema: uploadsResponseSchema, valid: { jobs: [job] }, invalid: { jobs: [{ ...job, status: "cancelled" }] } },
  { name: "queued upload", schema: uploadQueuedResponseSchema, valid: { job: { ...job, status: "queued", progress: 0 } }, invalid: { job: { ...job, progress: 101 } } },
  { name: "ingestion events", schema: ingestionEventsResponseSchema, valid: { events: [event] }, invalid: { events: [{ ...event, durationMs: "12" }] } },
  { name: "passage preview", schema: ingestionPassagePreviewSchema, valid: preview, invalid: { ...preview, passages: [{ ...preview.passages[0], excerpt: "x".repeat(601) }] } },
  { name: "cancel receipt", schema: uploadCancelledResponseSchema, valid: { jobId: job.id, status: "cancelled" }, invalid: { jobId: job.id, status: "queued" } },
  { name: "retry receipt", schema: uploadRetriedResponseSchema, valid: { jobId: job.id, status: "queued" }, invalid: { jobId: job.id, status: "failed" } },
  { name: "evaluations", schema: evaluationsResponseSchema, valid: { runs: [evaluation] }, invalid: { runs: [{ ...evaluation, hitRate: 100 }] } },
  { name: "created evaluation", schema: evaluationCreatedResponseSchema, valid: { run: evaluation }, invalid: { run: { ...evaluation, passed: "true" } } },
];

for (const entry of contractCases) {
  test(`wire contract: ${entry.name} rejects malformed success before caching and accepts compatible data`, async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const key = ["contract", "private", userId, workspaceId, entry.name];
    const payload = { ...entry.invalid, sensitiveField: "PRIVATE_RESPONSE_SENTINEL" };
    await expect(client.fetchQuery({ queryKey: key, queryFn: async () => decodeApiResponse(entry.schema, payload) }))
      .rejects.toMatchObject({ name: "ApiError", status: 502, code: "invalid_response" });
    expect(client.getQueryData(key)).toBeUndefined();
    const failure = client.getQueryCache().find({ queryKey: key })?.state.error;
    expect(String(failure)).not.toContain("PRIVATE_RESPONSE_SENTINEL");
    expect(failure).not.toHaveProperty("issues");
    const recovered = await client.fetchQuery({ queryKey: key, queryFn: async () => decodeApiResponse(entry.schema, { ...entry.valid, futureRolloutField: true }) });
    expect(recovered).toEqual(entry.valid);
    client.clear();
  });
}

test("wire contract: malformed JSON is sanitized and cancellation is preserved", async () => {
  await expect(readJsonResponse(new Response("PRIVATE_JSON_SENTINEL")))
    .rejects.toMatchObject({ name: "ApiError", code: "invalid_response" });
  const abort = new DOMException("The request was cancelled.", "AbortError");
  const response = new Response(new ReadableStream({ start(controller) { controller.error(abort); } }));
  await expect(readJsonResponse(response)).rejects.toBe(abort);
});

const browserFailures = [
  { name: "workspace role", path: "/workspace/team", endpoint: "**/v1/workspaces", body: { workspaces: [{ ...workspace, role: "administrator" }] }, message: /We could not load your workspaces|Não conseguimos carregar seus espaços/ },
  { name: "member role", path: "/workspace/team", endpoint: "**/v1/workspaces/*/members", body: { members: [{ ...member, role: "superuser" }] }, message: /couldn’t load the member list|Não foi possível carregar a lista de pessoas/ },
  { name: "document count", path: "/workspace/knowledge", endpoint: "**/v1/admin/documents", body: { documents: [{ ...document, chunkCount: "2" }] }, message: /We could not load documents|Não foi possível carregar os documentos/ },
  { name: "upload progress", path: "/workspace/processing", endpoint: "**/v1/admin/uploads", body: { jobs: [{ ...job, progress: "100" }] }, message: /We could not load processing jobs|Não foi possível carregar os processamentos/ },
  { name: "evaluation metrics", path: "/workspace/evaluations", endpoint: "**/v1/admin/evaluations?*", body: { runs: [{ ...evaluation, hitRate: 100 }] }, message: /We could not load evaluations|Não foi possível carregar as avaliações/ },
];

for (const entry of browserFailures) {
  test(`malformed success: ${entry.name} shows a recoverable request error`, async ({ page, context }) => {
    await workspaceFixture().attach(context);
    await context.route(entry.endpoint, (route) => route.fulfill({ json: entry.body }));
    await page.goto(entry.path);
    await expect(page.getByRole("alert").filter({ hasText: entry.message })).toBeVisible();
    await expect(page.getByRole("button", { name: /^(Try again|Tentar novamente)$/ })).toBeVisible();
    await expect(page.getByText("Contract sample", { exact: true })).toHaveCount(0);
    await expect(page.getByRole("heading", { name: /We could not open this section|Não conseguimos abrir esta seção/ })).toHaveCount(0);
  });
}

test("malformed success: search never renders a coerced score or unsafe risk", async ({ page, context }) => {
  await workspaceFixture().attach(context);
  await context.route("**/v1/search?*", (route) => route.fulfill({ json: { results: [{ ...search, score: "0.8" }] } }));
  await page.goto("/search");
  await page.getByRole("textbox", { name: /What are you looking for|O que você está procurando/ }).fill("How do I request access?");
  await page.locator("form").getByRole("button", { name: /^(Search|Buscar)$/ }).click();
  await expect(page.getByRole("alert")).toBeVisible();
  await expect(page.getByText("Contract sample", { exact: true })).toHaveCount(0);
  await expect(page.getByText("Reviewed passage.", { exact: true })).toHaveCount(0);
});

test("malformed success: document passages fail locally while their dialog remains usable", async ({ page, context }) => {
  await workspaceFixture().attach(context);
  await context.route("**/v1/admin/documents", (route) => route.fulfill({ json: { documents: [document] } }));
  await context.route("**/v1/admin/documents/*/chunks", (route) => route.fulfill({ json: { chunks: [{ ...chunk, ordinal: "0" }] } }));
  await page.goto("/workspace/knowledge");
  await page.getByRole("button", { name: /^Contract sample/ }).click();
  const dialog = page.getByRole("dialog", { name: "Contract sample" });
  await expect(dialog.getByRole("alert")).toContainText(/We could not load these passages|Não foi possível carregar estes trechos/);
  await expect(dialog.getByText("Reviewed passage.", { exact: true })).toHaveCount(0);
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
});

test("malformed success: ingestion events never enter the processing timeline", async ({ page, context }) => {
  await workspaceFixture().attach(context);
  await context.route("**/v1/admin/uploads", (route) => route.fulfill({ json: { jobs: [job] } }));
  await context.route("**/v1/admin/uploads/*/events", (route) => route.fulfill({ json: { events: [{ ...event, durationMs: "12" }] } }));
  await page.goto("/workspace/processing");
  await page.getByRole("button", { name: /^Contract sample/ }).click();
  const dialog = page.getByRole("dialog", { name: "Contract sample" });
  await expect(dialog.getByRole("alert")).toContainText(/We could not load the processing timeline|Não foi possível carregar a linha do tempo/);
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
});

test("malformed success: an invalid upload receipt does not close the form or announce success", async ({ page, context }) => {
  await workspaceFixture().attach(context);
  await context.route("**/v1/admin/uploads", (route) => route.request().method() === "POST"
    ? route.fulfill({ status: 202, json: { job: { ...job, progress: 101 } } }) : route.fallback());
  await page.goto("/workspace/knowledge");
  await page.getByRole("button", { name: /^(Add documents|Adicionar documentos)$/ }).click();
  const dialog = page.getByRole("dialog", { name: /^(Add documents|Adicionar documentos)$/ });
  await dialog.locator('input[type="file"]').setInputFiles({ name: "sample.md", mimeType: "text/markdown", buffer: Buffer.from("# Reviewed sample") });
  await dialog.getByRole("button", { name: /^(Send for processing|Enviar para processamento)$/ }).click();
  await expect(dialog.getByRole("alert")).toBeVisible();
  await expect(dialog).toBeVisible();
  await expect(page.getByText(/Material received|Material recebido/)).toHaveCount(0);
});
