import { QueryClient } from "@tanstack/react-query";
import { expect, test } from "@playwright/test";
import { apiResponseError } from "../../apps/web/src/shared/api/api-error";
import { privateQueryKey, transitionQueryIdentity } from "../../apps/web/src/shared/lib/query-keys";
import { workspaceFixture } from "./workspace-fixture";

test("identity changes abort old readers, remove private data and preserve public cache", async () => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const key = privateQueryKey("documents", "first-user", "workspace");
  const messages = privateQueryKey("conversation-messages", "first-user", "workspace", "conversation");
  client.setQueryData(["health"], { status: "ok" });
  client.setQueryData(["knowledge-status", "public-demo"], { passages: 2 });
  client.setQueryData(messages, { turns: ["private content"] });
  let signal!: AbortSignal;
  let release!: (value: { documents: string[] }) => void;
  const pending = client.fetchQuery({ queryKey: key, queryFn: (context) => {
    signal = context.signal;
    return new Promise<{ documents: string[] }>((resolve) => { release = resolve; });
  } });
  const cancelled = pending.catch(() => "cancelled");
  expect(transitionQueryIdentity(client, "first-user", null)).toBe(true);
  expect(signal.aborted).toBe(true);
  release({ documents: ["late private response"] });
  await expect(cancelled).resolves.toBe("cancelled");
  expect(client.getQueryData(key)).toBeUndefined();
  expect(client.getQueryData(messages)).toBeUndefined();
  expect(client.getQueryData(["health"])).toEqual({ status: "ok" });
  expect(client.getQueryData(["knowledge-status", "public-demo"])).toEqual({ passages: 2 });
  client.clear();
});

test("same-identity token refresh retains scoped records while another identity and workspace cannot reuse them", () => {
  const client = new QueryClient();
  const key = privateQueryKey("documents", "first-user", "first-workspace", { language: "en" });
  client.setQueryData(key, { documents: ["existing record"] });
  expect(transitionQueryIdentity(client, "first-user", "first-user")).toBe(false);
  expect(client.getQueryData(key)).toEqual({ documents: ["existing record"] });
  expect(client.getQueryData(privateQueryKey("documents", "second-user", "first-workspace", { language: "en" }))).toBeUndefined();
  expect(client.getQueryData(privateQueryKey("documents", "first-user", "second-workspace", { language: "en" }))).toBeUndefined();
  expect(JSON.stringify(client.getQueryCache().getAll().map((query) => query.queryKey))).not.toContain("Bearer");
  expect(transitionQueryIdentity(client, "first-user", "second-user")).toBe(true);
  expect(client.getQueryData(key)).toBeUndefined();
  client.clear();
});

test("API errors preserve machine reason codes and handle invalid error bodies safely", async () => {
  const error = await apiResponseError(new Response(JSON.stringify({ error: "Quota reached.", code: "daily_quota_exceeded" }), { status: 429 }));
  expect({ name: error.name, message: error.message, status: error.status, code: error.code })
    .toEqual({ name: "ApiError", message: "Quota reached.", status: 429, code: "daily_quota_exceeded" });
  const invalid = await apiResponseError(new Response("<html>gateway error</html>", { status: 502 }), "Try again.");
  expect({ message: invalid.message, status: invalid.status, code: invalid.code })
    .toEqual({ message: "Try again.", status: 502, code: undefined });
  const unsafe = await apiResponseError(new Response(JSON.stringify({ code: "raw secret or document content" }), { status: 400 }));
  expect(unsafe.code).toBeUndefined();
});

test("changing a member role sends an authenticated JSON request", async ({ page, context }) => {
  await workspaceFixture().attach(context);
  let changes = 0;
  await context.route("**/v1/workspaces/*/members/*", async (route) => {
    if (route.request().method() !== "PATCH") return route.fallback();
    const request = route.request();
    expect(request.headers()["content-type"]).toMatch(/^application\/json/);
    expect(request.headers().authorization).toBe("Bearer fixture-workspace-token");
    expect(request.headers()["x-workspace-id"]).toBe("11111111-1111-4111-a111-111111111111");
    expect(request.postDataJSON()).toEqual({ role: "viewer" });
    changes++;
    return route.fulfill({ status: 204 });
  });
  await page.goto("/workspace/team");
  await page.getByRole("button", { name: /^(Actions for|Ações para) editor@example.test$/ }).click();
  await page.getByRole("menuitem", { name: /^(Change role|Alterar perfil)$/ }).click();
  const dialog = page.getByRole("dialog", { name: /^(Change role|Alterar perfil)$/ });
  await dialog.getByRole("radio", { name: /^(Viewer|Leitor)$/ }).check();
  await dialog.getByRole("button", { name: /^(Save role|Salvar perfil)$/ }).click();
  await expect(dialog).toBeHidden();
  await expect(page.getByRole("status").filter({ hasText: /Role updated|Perfil de/ })).toBeVisible();
  expect(changes).toBe(1);
});

test("external auth transitions load the new user's workspace records and remove the previous surface", async ({ page, context }) => {
  await workspaceFixture().attach(context);
  const nextUser = "66666666-6666-4666-a666-666666666666";
  const workspaceId = "11111111-1111-4111-a111-111111111111";
  let workspaces = 0;
  await context.route("**/v1/**", async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    if (path === "/v1/workspaces") workspaces++;
    if (request.headers().authorization !== "Bearer second-identity-token") return route.fallback();
    if (path === "/v1/workspaces") return route.fulfill({ json: { workspaces: [{ tenantId: workspaceId, tenantName: "Shared workspace", tenantSlug: "shared-workspace", role: "owner" }] } });
    if (path.endsWith("/onboarding")) return route.fulfill({ json: { progress: { goal: "knowledge", step: "answer", completed: true } } });
    if (path.endsWith("/members")) return route.fulfill({ json: { members: [{ userId: nextUser, email: "second@example.test", role: "owner", createdAt: "2026-11-07T12:00:00.000Z" }] } });
    if (path === "/v1/knowledge/status") return route.fulfill({ json: { indexedDocuments: 1, passages: 1, processingJobs: 0, failedJobs: 0 } });
    return route.fulfill({ status: 404, json: { error: "No fixture record." } });
  });
  await page.goto("/workspace/team");
  await expect(page.getByText("owner@example.test", { exact: true })).toBeVisible();
  await page.evaluate((id) => {
    const stored = JSON.parse(localStorage.getItem("sb-fixture-auth-token")!);
    const session = { ...stored, access_token: "second-identity-token", user: { ...stored.user, id, email: "second@example.test" } };
    localStorage.setItem("sb-fixture-auth-token", JSON.stringify(session));
    const channel = new BroadcastChannel("sb-fixture-auth-token");
    channel.postMessage({ event: "SIGNED_IN", session });
    channel.close();
  }, nextUser);
  await expect(page.getByText("second@example.test", { exact: true })).toBeVisible();
  await expect(page.getByText("owner@example.test", { exact: true })).toHaveCount(0);
  expect(workspaces).toBe(2);
  await page.evaluate(() => {
    localStorage.removeItem("sb-fixture-auth-token");
    const channel = new BroadcastChannel("sb-fixture-auth-token");
    channel.postMessage({ event: "SIGNED_OUT", session: null });
    channel.close();
  });
  await expect(page).toHaveURL(/\/sign-in$/);
  await expect(page.getByText("second@example.test", { exact: true })).toHaveCount(0);
});

test("section rendering failure preserves navigation, supports retry and emits no raw error", async ({ page, context }) => {
  await workspaceFixture().attach(context);
  const diagnostics: string[] = [];
  page.on("console", (message) => { if (message.type() === "error") diagnostics.push(message.text()); });
  await context.route("**/assets/WorkspaceTeam-*.js", (route) => route.fulfill({
    contentType: "application/javascript",
    body: `export function WorkspaceTeam() { if (!globalThis.sectionRecovered) throw new Error("SENSITIVE_PROMPT_AND_TOKEN_SENTINEL"); return "Recovered team section"; }`,
  }));
  await page.goto("/workspace/team");
  const failure = page.getByRole("alert").filter({ hasText: /We could not open this section|Não conseguimos abrir esta seção/ });
  await expect(failure).toBeVisible();
  await expect(page.getByRole("navigation", { name: /Workspace sections|Seções do espaço de trabalho/ })).toBeVisible();
  const retry = failure.getByRole("button", { name: /^(Try again|Tentar novamente)$/ });
  await expect(retry).toBeFocused();
  expect(diagnostics.some((event) => event.includes("ui_render_failed"))).toBe(true);
  expect(diagnostics.join("\n")).not.toContain("SENSITIVE_PROMPT_AND_TOKEN_SENTINEL");
  await page.evaluate(() => { Object.assign(globalThis, { sectionRecovered: true }); });
  await retry.click();
  await expect(page.getByText("Recovered team section", { exact: true })).toBeVisible();
  await expect(failure).toHaveCount(0);
  await page.getByRole("button", { name: /^(Overview|Visão geral)$/ }).click();
  await expect(page).toHaveURL(/\/workspace\/overview$/);
  await expect(page.getByRole("heading", { name: /^(Overview|Visão geral)$/ })).toBeVisible();
});

test("a failed lazy download leaves other sections usable and reload recovers the module", async ({ page, context }) => {
  await workspaceFixture().attach(context);
  let available = false;
  await context.route("**/assets/WorkspaceTeam-*.js", (route) => available ? route.continue() : route.abort("failed"));
  await page.goto("/workspace/team");
  const failure = page.getByRole("alert").filter({ hasText: /We could not open this section|Não conseguimos abrir esta seção/ });
  await expect(failure).toBeVisible();
  await page.getByRole("button", { name: /^(Overview|Visão geral)$/ }).click();
  await expect(page.getByRole("heading", { name: /^(Overview|Visão geral)$/ })).toBeVisible();
  await page.getByRole("button", { name: /^(Team|Equipe)$/ }).click();
  await expect(failure).toBeVisible();
  // Browsers may cache a rejected module import. Explicit reload starts a new
  // module graph; there is intentionally no automatic reload/retry loop.
  available = true;
  await failure.getByRole("button", { name: /^(Reload page|Recarregar página)$/ }).click();
  await expect(page.getByText("owner@example.test", { exact: true })).toBeVisible();
  await expect(failure).toHaveCount(0);
});
