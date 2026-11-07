import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import { workspaceFixture } from "./workspace-fixture";

const inviteName = /^(Invite a teammate|Convidar pessoa)$/;
const viewerName = /^(Viewer|Leitor)$/;
const accessName = /Access role|Tipo de acesso/;

test("invitation roles are visible immediately, accessible and selectable without a popup", async ({ page, context }, info) => {
  await workspaceFixture().attach(context);
  await page.goto("/workspace/team");
  const opener = page.getByRole("button", { name: inviteName });
  await opener.click();
  const dialog = page.getByRole("dialog", { name: inviteName });
  const group = dialog.getByRole("group", { name: accessName });
  const viewer = group.getByRole("radio", { name: viewerName });
  const editor = group.getByRole("radio", { name: "Editor", exact: true });
  await expect(group.getByRole("radio")).toHaveCount(2);
  await expect(viewer).toBeInViewport();
  await expect(editor).toBeInViewport();
  await expect(viewer).toBeChecked();
  await expect(dialog.getByRole("combobox")).toHaveCount(0);
  await editor.check();
  await expect(editor).toBeChecked();
  await expect(viewer).not.toBeChecked();
  await expect(dialog.getByText(/Can ask questions and manage documents|Pode fazer perguntas e gerenciar documentos/)).toBeVisible();
  const audit = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
  expect(audit.violations.map(({ id, nodes }) => ({ id, elements: nodes.map(({ target }) => target) }))).toEqual([]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
  if (process.platform === "linux" && process.arch === "x64" && /^(desktop-en|tablet-en|mobile-pt)$/.test(info.project.name))
    await expect(page).toHaveScreenshot("invite-access.png", { fullPage: true });
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
  await expect(opener).toBeFocused();
});

test("native keyboard selection submits the chosen role once and freezes access while sending", async ({ page, context }) => {
  await workspaceFixture().attach(context);
  let release!: () => void;
  const response = new Promise<void>((resolve) => { release = resolve; });
  const calls: unknown[] = [];
  await context.route("**/v1/workspaces/*/invitations", async (route) => {
    expect(route.request().headers()["x-workspace-id"]).toBe("11111111-1111-4111-a111-111111111111");
    calls.push(route.request().postDataJSON());
    await response;
    await route.fulfill({ status: 201, json: { member: { userId: "fixture-invited", email: "teammate@example.test", role: "editor" } } });
  });
  await page.goto("/workspace/team");
  await page.getByRole("button", { name: inviteName }).click();
  const dialog = page.getByRole("dialog", { name: inviteName });
  const email = dialog.getByRole("textbox", { name: /Email address|Endereço de e-mail/ });
  await expect(email).toBeFocused();
  await email.fill("teammate@example.test");
  await email.press("Tab");
  const viewer = dialog.getByRole("radio", { name: viewerName });
  const editor = dialog.getByRole("radio", { name: "Editor", exact: true });
  await expect(viewer).toBeFocused();
  await viewer.press("ArrowRight");
  await expect(editor).toBeFocused();
  await expect(editor).toBeChecked();
  try {
    await dialog.getByRole("button", { name: /Send invitation|Enviar convite/ }).click();
    await expect(viewer).toBeDisabled();
    await expect(editor).toBeDisabled();
    await expect(dialog.getByRole("button", { name: /^(Cancel|Cancelar)$/ })).toBeDisabled();
    await page.keyboard.press("Escape");
    await expect(dialog).toBeVisible();
    await expect.poll(() => calls).toEqual([{ email: "teammate@example.test", role: "editor" }]);
  } finally { release(); }
  await expect(dialog).toBeHidden();
});

test("invitation access stays usable above the nested Milo guide and returns focus on close", async ({ page, context }) => {
  await workspaceFixture().attach(context);
  await page.goto("/workspace/overview");
  await page.getByRole("button", { name: /^(Help|Ajuda)$/ }).click();
  const guide = page.getByRole("dialog", { name: /^(Milo’s guide|Guia do Milo)$/ });
  await guide.getByRole("radio", { name: /^(Knowledge and processes|Conhecimento e processos)/ }).check();
  await guide.getByRole("button", { name: /^(Continue|Continuar)$/ }).click();
  await guide.getByText(/Bring your team \(optional\)|Convide sua equipe \(opcional\)/).click();
  const opener = guide.getByRole("button", { name: inviteName });
  await opener.click();
  const invite = page.getByRole("dialog", { name: inviteName });
  const editor = invite.getByRole("radio", { name: "Editor", exact: true });
  await expect(editor).toBeInViewport();
  await editor.check();
  await expect(editor).toBeChecked();
  await page.keyboard.press("Escape");
  await expect(invite).toBeHidden();
  await expect(guide).toBeVisible();
  await expect(opener).toBeFocused();
});

test("invitation roles remain available after scrolling through onboarding", async ({ page, context }) => {
  await workspaceFixture({ goal: "knowledge", step: "knowledge", completed: false }).attach(context);
  await page.goto("/onboarding");
  await page.getByText(/Bring your team \(optional\)|Convide sua equipe \(opcional\)/).click();
  await page.getByRole("button", { name: inviteName }).click();
  const invite = page.getByRole("dialog", { name: inviteName });
  const editor = invite.getByRole("radio", { name: "Editor", exact: true });
  await expect(editor).toBeInViewport();
  await editor.check();
  await expect(editor).toBeChecked();
});
