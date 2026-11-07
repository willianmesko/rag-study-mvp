import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import { workspaceFixture } from "./workspace-fixture";

const workspaceId = "11111111-1111-4111-a111-111111111111";
const requestId = "55555555-5555-4555-a555-555555555555";
const connectionId = "66666666-6666-4666-a666-666666666666";
const token = "fixture-workspace-token";
const details = { id: requestId, clientName: "My assistant", redirectOrigin: "https://assistant.example", resource: "https://api.example/mcp",
  expiresAt: "2099-01-01T00:00:00.000Z", tools: ["list_sources","get_document","search_workspace","get_ingestion_status","get_quality_report"] };

test("OAuth consent requires a deliberate workspace choice, shows read permissions, and is accessible", async ({ page, context }, info) => {
  await workspaceFixture({ goal: "knowledge", step: "knowledge", completed: false }).attach(context);
  const submissions: unknown[] = [];
  await context.route("**/v1/mcp/oauth/requests/**", async (route) => {
    expect(route.request().headers().authorization).toBe(`Bearer ${token}`);
    if (route.request().method() === "GET") return route.fulfill({ json: details });
    submissions.push(route.request().postDataJSON());
    expect(route.request().headers()["x-workspace-id"]).toBe(workspaceId);
    return route.fulfill({ status: 403, json: { error: "Permissions changed." } });
  });
  await page.goto(`/mcp/authorize?requestId=${requestId}`);
  await expect(page.getByRole("heading", { name: /Connect your assistant|Conecte seu assistente/ })).toBeVisible();
  await expect(page).toHaveURL(new RegExp(`/mcp/authorize\\?requestId=${requestId}$`));
  const allow = page.getByRole("button", { name: /Allow connection|Permitir conexão/ });
  await expect(allow).toBeDisabled();
  await page.getByRole("combobox", { name: /Choose a workspace|Escolha um espaço/ }).selectOption(workspaceId);
  await expect(allow).toBeEnabled();
  const quality = page.getByRole("checkbox", { name: /quality reports|qualidade salvos/ });
  await expect(quality).not.toBeChecked();
  const audit = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
  expect(audit.violations.map(({ id }) => id)).toEqual([]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
  if (process.platform === "linux" && process.arch === "x64") await expect(page).toHaveScreenshot("mcp-consent.png", { fullPage: true });
  await allow.click();
  await expect.poll(() => submissions.length).toBe(1);
  expect(submissions[0]).toEqual({ tools: ["list_sources","get_ingestion_status","get_document","search_workspace"] });
  await expect(page.getByRole("alert")).toBeVisible();
});

test("viewers cannot approve owner reports, and declining never sends a tool or workspace grant", async ({ page, context }) => {
  await workspaceFixture(null, "viewer").attach(context);
  let denied = false;
  await context.route("**/v1/mcp/oauth/requests/**", async (route) => {
    if (route.request().method() === "GET") return route.fulfill({ json: details });
    expect(route.request().url()).toMatch(/\/deny$/);
    expect(route.request().headers()["x-workspace-id"]).toBeUndefined(); denied = true;
    return route.fulfill({ status: 410, json: { error: "Request expired." } });
  });
  await page.goto(`/mcp/authorize?requestId=${requestId}`);
  await page.getByRole("combobox").selectOption(workspaceId);
  await expect(page.getByRole("checkbox", { name: /quality reports|qualidade salvos/ })).toHaveCount(0);
  await page.getByRole("button", { name: /Decline|Recusar/ }).click();
  await expect.poll(() => denied).toBe(true);
});

test("an expired OAuth request has a useful recovery state and no approval button", async ({ page, context }) => {
  await workspaceFixture().attach(context);
  await context.route("**/v1/mcp/oauth/requests/**", (route) => route.fulfill({ status: 410, json: { error: "Expired request." } }));
  await page.goto(`/mcp/authorize?requestId=${requestId}`);
  await expect(page.getByRole("alert")).toContainText(/expired|expirou/);
  await expect(page.getByRole("button", { name: /Allow connection|Permitir conexão/ })).toHaveCount(0);
});

test("members can reach and revoke only their displayed connections without completing onboarding", async ({ page, context }) => {
  await workspaceFixture({ goal: "knowledge", step: "knowledge", completed: false }, "viewer").attach(context);
  let revoked = false;
  await context.route("**/v1/mcp/connections**", async (route) => {
    expect(route.request().headers()["x-workspace-id"]).toBe(workspaceId);
    if (route.request().method() === "DELETE") { expect(route.request().url()).toMatch(new RegExp(`${connectionId}$`)); revoked = true; return route.fulfill({ status: 204 }); }
    return route.fulfill({ json: { url: "https://api.example/mcp", connections: revoked ? [] : [{ id: connectionId, clientName: "My assistant", allowedTools: ["list_sources"], expiresAt: "2099-01-01T00:00:00.000Z", createdAt: "2026-11-07T00:00:00.000Z" }] } });
  });
  await page.goto("/connections");
  await expect(page.getByLabel(/MCP server URL|URL do servidor MCP/)).toHaveValue("https://api.example/mcp");
  await page.getByRole("button", { name: /^Revoke My assistant$|^Revogar My assistant$/ }).click();
  await expect(page.getByText(/No assistants connected yet|Nenhum assistente conectado ainda/)).toBeVisible();
  expect(revoked).toBe(true);
});

test("sign-in preserves the OAuth request and returns to consent instead of onboarding", async ({ page, context }) => {
  await workspaceFixture(null).attach(context);
  await context.addInitScript(() => localStorage.removeItem("sb-fixture-auth-token"));
  await context.route("**/v1/mcp/oauth/requests/**", (route) => route.fulfill({ json: details }));
  await context.route("https://fixture.supabase.co/auth/v1/token**", (route) => route.fulfill({ json: {
    access_token: token, refresh_token: "fixture-refresh-token", token_type: "bearer", expires_in: 3600,
    user: { id: "22222222-2222-4222-a222-222222222222", email: "owner@example.test", aud: "authenticated", role: "authenticated", app_metadata: {}, user_metadata: {} }
  } }));
  await page.goto(`/mcp/authorize?requestId=${requestId}`);
  await page.getByLabel(/Email address|E-mail/).fill("owner@example.test");
  await page.getByLabel(/^(Password|Senha)$/).fill("fixture-password");
  await page.getByRole("button", { name: /^(Sign in|Entrar)$/ }).click();
  await expect(page.getByRole("heading", { name: /Connect your assistant|Conecte seu assistente/ })).toBeVisible();
  await expect(page).toHaveURL(new RegExp(`/mcp/authorize\\?requestId=${requestId}$`));
});
