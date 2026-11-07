import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import { workspaceFixture } from "./workspace-fixture";

const workspaceId = "11111111-1111-4111-a111-111111111111";
const accessKey = `lumora_mcp_${"a".repeat(43)}`;
const headers = { authorization: "Bearer fixture-workspace-token", "x-workspace-id": workspaceId };

test("workspace MCP keys stay masked and temporary, and owners can revoke access", async ({ page, context }) => {
  await workspaceFixture().attach(context);
  let expiresAt: string | null = null;
  let issued = 0;
  let revoked = 0;
  await context.route("**/v1/mcp/access", async (route) => {
    const request = route.request();
    expect(request.headers()).toMatchObject(headers);
    if (request.method() === "POST") {
      issued += 1;
      expect(request.postData()).toBeNull();
      expiresAt = new Date(Date.now() + 15 * 60_000).toISOString();
      return route.fulfill({ status: 201, json: { token: accessKey, workspaceId, expiresAt } });
    }
    if (request.method() === "DELETE") {
      revoked += 1;
      expiresAt = null;
      return route.fulfill({ status: 204 });
    }
    expect(request.method()).toBe("GET");
    return route.fulfill({ json: { expiresAt } });
  });

  await page.goto("/workspace/settings");
  await expect(page.getByRole("heading", { name: /Connect your assistant|Conecte seu assistente/ })).toBeVisible();
  await page.getByRole("button", { name: /Create temporary key|Criar chave temporária/ }).click();
  const credential = page.getByLabel(/Temporary MCP key|Chave temporária do MCP/, { exact: true });
  await expect(credential).toHaveValue(accessKey);
  await expect(credential).toHaveAttribute("type", "password");
  await expect(page.getByText(/Current key expires at|A chave atual expira às/)).toBeVisible();
  await page.getByRole("button", { name: /Show key|Mostrar chave/ }).click();
  await expect(credential).toHaveAttribute("type", "text");
  await page.getByRole("button", { name: /Hide key|Ocultar chave/ }).click();
  await expect(credential).toHaveAttribute("type", "password");

  const browserStorage = await page.evaluate(() => JSON.stringify({
    local: Object.values(localStorage), session: Object.values(sessionStorage)
  }));
  expect(browserStorage).not.toContain(accessKey);
  const layout = await page.evaluate(() => ({
    content: document.documentElement.scrollWidth, viewport: document.documentElement.clientWidth
  }));
  expect(layout.content).toBeLessThanOrEqual(layout.viewport);
  const audit = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
  expect(audit.violations.map(({ id, nodes }) => ({ id, elements: nodes.map(({ target }) => target) }))).toEqual([]);

  await page.reload();
  await expect(page.getByText(/Current key expires at|A chave atual expira às/)).toBeVisible();
  await expect(credential).toHaveCount(0);
  await page.getByRole("button", { name: /Revoke key|Revogar chave/ }).click();
  await expect(page.getByText(/Current key expires at|A chave atual expira às/)).toHaveCount(0);
  await expect(page.getByRole("button", { name: /Revoke key|Revogar chave/ })).toHaveCount(0);
  expect(issued).toBe(1);
  expect(revoked).toBe(1);
});
