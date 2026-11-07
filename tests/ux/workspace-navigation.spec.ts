import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import { workspaceFixture } from "./workspace-fixture";

const primaryWorkspace = {
  tenantId: "11111111-1111-4111-a111-111111111111",
  tenantName: "Northstar Studio",
  tenantSlug: "northstar-studio",
  role: "owner"
};
const secondWorkspace = {
  tenantId: "55555555-5555-4555-a555-555555555555",
  tenantName: "Aurora Operations with a longer workspace name",
  tenantSlug: "aurora-operations",
  role: "viewer"
};
const triggerName = /^(Workspace|Espaço de trabalho): Northstar Studio, (Owner|Proprietário)$/;
const createAction = /^(New workspace|Novo espaço)$/;
const creationDialog = /^(Create a workspace|Crie um espaço de trabalho)$/;

test("workspace navigation stays in the sidebar and switches to an accessible section", async ({ page, context }) => {
  await workspaceFixture().attach(context);
  await context.route("**/v1/**", async (route) => {
    const request = route.request();
    if (request.headers()["x-workspace-id"] !== secondWorkspace.tenantId) return route.fallback();
    expect(request.headers().authorization).toBe("Bearer fixture-workspace-token");
    const { pathname } = new URL(request.url());
    if (pathname === `/v1/workspaces/${secondWorkspace.tenantId}/onboarding`) {
      return route.fulfill({ json: { progress: { goal: "knowledge", step: "answer", completed: true } } });
    }
    if (pathname === "/v1/admin/documents") return route.fulfill({ json: { documents: [] } });
    if (pathname === "/v1/admin/uploads") return route.fulfill({ json: { jobs: [] } });
    return route.fulfill({ status: 404, json: { error: "Unrecognized secondary workspace fixture route." } });
  });
  await context.route("**/v1/workspaces", (route) => {
    expect(route.request().headers().authorization).toBe("Bearer fixture-workspace-token");
    return route.fulfill({ json: { workspaces: [primaryWorkspace, secondWorkspace] } });
  });

  await page.goto("/workspace/team");
  const sidebar = page.locator("aside").filter({ has: page.getByRole("navigation", { name: /Main navigation|Navegação principal/ }) });
  const trigger = sidebar.getByRole("button", { name: triggerName });
  await expect(trigger).toBeVisible();
  await expect(trigger).toContainText(/Owner|Proprietário/);
  await trigger.click();
  const menu = page.getByRole("menu");
  await expect(menu.getByRole("menuitemradio", { name: /^Northstar Studio/ })).toBeChecked();
  await expect(menu.getByRole("menuitemradio", { name: /^Aurora Operations/ })).not.toBeChecked();
  await expect(menu.getByRole("menuitem", { name: createAction })).toBeVisible();

  const bounds = await menu.boundingBox();
  const viewport = page.viewportSize()!;
  expect(bounds).not.toBeNull();
  expect(bounds!.x).toBeGreaterThanOrEqual(0);
  expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(viewport.width);
  const audit = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
  expect(audit.violations.map(({ id, nodes }) => ({ id, elements: nodes.map(({ target }) => target) }))).toEqual([]);

  await page.mouse.click(viewport.width - 2, viewport.height - 2);
  await expect(menu).toBeHidden();
  await trigger.click();
  await menu.getByRole("menuitemradio", { name: /^Aurora Operations/ }).click();
  await expect(page).toHaveURL(/\/workspace\/overview$/);
  const selected = sidebar.getByRole("button", { name: /^(Workspace|Espaço de trabalho): Aurora Operations/ });
  await expect(selected).toBeVisible();
  await expect(selected).toContainText(/Viewer|Leitor/);
  const layout = await page.evaluate(() => ({ content: document.documentElement.scrollWidth, viewport: document.documentElement.clientWidth }));
  expect(layout.content).toBeLessThanOrEqual(layout.viewport);
  await selected.press("Enter");
  await expect(page.getByRole("menuitemradio", { name: /^Aurora Operations/ })).toBeChecked();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("menu")).toBeHidden();
  await expect(selected).toBeFocused();
});

test("canceling workspace creation returns focus to the workspace menu", async ({ page, context }) => {
  await workspaceFixture().attach(context);
  const created: string[] = [];
  page.on("request", (request) => {
    if (request.method() === "POST" && new URL(request.url()).pathname === "/v1/workspaces") created.push(request.url());
  });
  await page.goto("/ask");
  const trigger = page.getByRole("button", { name: triggerName });
  await trigger.press("Enter");
  await page.getByRole("menuitem", { name: createAction }).press("Enter");
  const dialog = page.getByRole("dialog", { name: creationDialog });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole("textbox", { name: /Workspace name|Nome do espaço/ })).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
  await expect(trigger).toBeFocused();

  await trigger.click();
  await page.getByRole("menuitem", { name: createAction }).click();
  await expect(dialog).toBeVisible();
  await dialog.getByRole("button", { name: /^(Cancel|Cancelar)$/ }).click();
  await expect(dialog).toBeHidden();
  await expect(trigger).toBeFocused();
  expect(created).toEqual([]);
});

test("creating a workspace from the menu opens its separate onboarding", async ({ page, context }) => {
  await workspaceFixture().attach(context);
  const workspace = { ...secondWorkspace, tenantName: "Customer Support", tenantSlug: "customer-support", role: "owner" };
  let created = false;
  await context.route("**/v1/workspaces", async (route) => {
    const request = route.request();
    expect(request.headers().authorization).toBe("Bearer fixture-workspace-token");
    if (request.method() === "POST") {
      expect(request.postDataJSON()).toMatchObject({ name: workspace.tenantName });
      created = true;
      return route.fulfill({ status: 201, json: { workspace } });
    }
    return route.fulfill({ json: { workspaces: created ? [primaryWorkspace, workspace] : [primaryWorkspace] } });
  });
  await context.route(`**/v1/workspaces/${workspace.tenantId}/onboarding`, (route) => {
    expect(route.request().headers()["x-workspace-id"]).toBe(workspace.tenantId);
    return route.fulfill({ json: { progress: null } });
  });

  await page.goto("/workspace/team");
  await page.getByRole("button", { name: triggerName }).click();
  await page.getByRole("menuitem", { name: createAction }).click();
  const dialog = page.getByRole("dialog", { name: creationDialog });
  await dialog.getByRole("textbox", { name: /Workspace name|Nome do espaço/ }).fill(workspace.tenantName);
  await dialog.getByRole("button", { name: /Create workspace and continue|Criar espaço e continuar/ }).click();
  await expect(dialog).toBeHidden();
  await expect(page).toHaveURL(/\/onboarding$/);
  await expect(page.getByRole("heading", { level: 1, name: /What will you use|Como você quer usar/ })).toBeVisible();
  await expect(page.getByRole("button",{name:/^(Workspace|Espaço de trabalho): Customer Support/})).toBeVisible();
  await expect(page.getByRole("radio", { name: /^(Knowledge and processes|Conhecimento e processos)/ })).toBeVisible();
  expect(created).toBe(true);
});
