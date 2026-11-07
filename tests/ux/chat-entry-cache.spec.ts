import { expect, test } from "@playwright/test";
import { workspaceFixture } from "./workspace-fixture";

test("returning to chat rechecks cached knowledge before enabling a question", async ({ page, context }) => {
  await workspaceFixture().attach(context);
  let changed = false;
  let release!: () => void;
  const response = new Promise<void>((resolve) => { release = resolve; });
  let lookups = 0;
  let questions = 0;
  await context.route("**/v1/knowledge/status", async (route) => {
    lookups++;
    if (changed) await response;
    await route.fulfill({ json: { indexedDocuments: changed ? 0 : 1, passages: changed ? 0 : 3, processingJobs: 0, failedJobs: 0 } });
  });
  page.on("request", (request) => { if (request.url().includes("/v1/qa/stream")) questions++; });
  await page.goto("/ask");
  await expect(page.locator("textarea")).toBeVisible();
  const nav = page.getByRole("navigation", { name: /Main navigation|Navegação principal/ });
  await nav.getByRole("button", { name: /^(Search|Buscar)$/ }).click();
  changed = true;
  try {
    await nav.getByRole("button", { name: /^(Ask|Perguntar)$/ }).click();
    await expect(page.getByRole("heading", { name: /Checking your documents|Conferindo seus documentos/ })).toBeVisible();
    await expect(page.locator("textarea")).toHaveCount(0);
    expect(lookups).toBeGreaterThanOrEqual(2);
    expect(questions).toBe(0);
  } finally { release(); }
  await expect(page.getByRole("heading", { name: /Start with your first document|Comece pelo seu primeiro documento/ })).toBeVisible();
  await expect(page.locator("textarea")).toHaveCount(0);
  expect(questions).toBe(0);
});
