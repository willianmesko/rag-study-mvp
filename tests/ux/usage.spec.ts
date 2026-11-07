import { readFile } from "node:fs/promises";
import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import { workspaceFixture } from "./workspace-fixture";
const workspaceId = "11111111-1111-4111-a111-111111111111";
test("usage has its own owner-only route and settings does not load the cost ledger", async ({
  page,
  context,
  browser,
  baseURL,
}, info) => {
  test.skip(
    info.project.name !== "desktop-en",
    "Routing and role checks are shared across viewport profiles.",
  );
  await workspaceFixture().attach(context);
  let reads = 0;
  await context.route("**/v1/admin/usage?*", (route) => {
    reads++;
    return route.fulfill({ json: response(30) });
  });
  await page.goto("/workspace/settings");
  await expect(
    page.getByRole("heading", { name: "Settings", exact: true }),
  ).toBeVisible();
  expect(reads).toBe(0);
  await expect(
    page.getByRole("region", { name: "AI usage", exact: true }),
  ).toHaveCount(0);
  await page
    .getByRole("navigation", { name: "Workspace sections" })
    .getByRole("button", { name: "Usage & costs", exact: true })
    .click();
  await expect(page).toHaveURL(/\/workspace\/usage$/);
  await expect(
    page.getByRole("heading", { name: "Usage & costs", exact: true }),
  ).toBeVisible();
  await expect.poll(() => reads).toBe(1);
  const viewer = await browser.newContext({
    baseURL,
    locale: "en-US",
    timezoneId: "UTC",
  });
  try {
    await workspaceFixture(
      { goal: "knowledge", step: "answer", completed: true },
      "viewer",
    ).attach(viewer);
    let privateReads = 0;
    await viewer.route("**/v1/admin/usage?*", (route) => {
      privateReads++;
      return route.fulfill({
        status: 403,
        json: { error: "Owner access required." },
      });
    });
    const other = await viewer.newPage();
    await other.goto("/workspace/usage");
    await expect(other).toHaveURL(/\/workspace\/overview$/);
    await expect(
      other.getByRole("button", { name: "Usage & costs", exact: true }),
    ).toHaveCount(0);
    expect(privateReads).toBe(0);
  } finally {
    await viewer.close();
  }
});
const totals = {
  requests: 8,
  cacheHits: 1,
  inputTokens: 3000,
  outputTokens: 600,
  estimatedCostUsd: 0.012,
  averageLatencyMs: 900,
  providerFailures: 1,
  observedRequests: 4,
  observedCostUsd: 0.0024,
  effectiveCostUsd: 0.01,
  estimatedOnlyCostUsd: 0.0076,
  observedCostRequests: 2,
  estimatedCostRequests: 4,
  skippedRequests: 1,
  observedInputTokens: 1600,
  observedOutputTokens: 300,
  estimatedInputTokens: 1400,
  estimatedOutputTokens: 300,
  p95LatencyMs: 2000,
};
const models = [
  {
    ...totals,
    provider: "openrouter",
    model: "openai/gpt-4.1-mini",
    requests: 2,
    cacheHits: 0,
    inputTokens: 2000,
    outputTokens: 400,
    effectiveCostUsd: 0.0064,
    estimatedCostUsd: 0.0064,
    observedCostUsd: 0,
    estimatedOnlyCostUsd: 0.0064,
    observedCostRequests: 0,
    estimatedCostRequests: 2,
    averageLatencyMs: 1200,
    p95LatencyMs: 1900,
  },
  {
    ...totals,
    provider: "openrouter",
    model: "openai/gpt-4o-mini",
    requests: 6,
    inputTokens: 1000,
    outputTokens: 200,
    effectiveCostUsd: 0.0036,
    estimatedCostUsd: 0.0056,
    estimatedOnlyCostUsd: 0.0012,
    estimatedCostRequests: 2,
    averageLatencyMs: 800,
    p95LatencyMs: 1200,
  },
];
function response(days: number) {
  const empty = days === 7;
  return {
    days,
    summary: {
      ...totals,
      ...(empty
        ? {
            requests: 0,
            cacheHits: 0,
            inputTokens: 0,
            outputTokens: 0,
            estimatedCostUsd: 0,
            observedCostUsd: 0,
            effectiveCostUsd: 0,
            estimatedOnlyCostUsd: 0,
            averageLatencyMs: 0,
            providerFailures: 0,
          }
        : {}),
      models: empty ? [] : models,
      operations: empty ? [] : [{ ...totals, operation: "question_answering" }],
      daily: empty
        ? []
        : [
            {
              ...totals,
              date: "2026-11-06",
              requests: 3,
              effectiveCostUsd: 0.004,
            },
            {
              ...totals,
              date: "2026-11-07",
              requests: 5,
              effectiveCostUsd: 0.006,
            },
          ],
      windowStart:
        days === 7
          ? "2026-10-31T12:00:00Z"
          : days === 90
            ? "2026-08-09T12:00:00Z"
            : "2026-10-08T12:00:00Z",
      windowEnd: "2026-11-07T12:00:00Z",
      actorKey: "must-not-export",
    },
    alert: { thresholdUsd: 1, triggered: false },
    privateQuestion: "must-not-export",
  };
}
test("cost by model shows provenance, supports periods, and exports only aggregate metrics", async ({
  page,
  context,
}, info) => {
  await workspaceFixture().attach(context);
  const requested: number[] = [];
  let reject90 = true;
  await context.route("**/v1/admin/usage?*", (route) => {
    const request = route.request();
    expect(request.headers()["x-workspace-id"]).toBe(workspaceId);
    const days = Number(new URL(request.url()).searchParams.get("days"));
    requested.push(days);
    if (days === 90 && reject90) {
      return route.fulfill({
        status: 503,
        json: { error: "Temporary fixture error" },
      });
    }
    return route.fulfill({ json: response(days) });
  });
  await page.goto("/workspace/usage");
  const panel = page.getByRole("region", { name: /^(AI usage|Uso de IA)$/ });
  await expect(
    panel.getByText("openai/gpt-4o-mini", { exact: true }),
  ).toBeVisible();
  await expect(
    panel.getByText("openai/gpt-4.1-mini", { exact: true }),
  ).toBeVisible();
  await expect(
    panel.getByText(/0[.,]0100/, { exact: false }).first(),
  ).toBeVisible();
  await expect(panel.getByText(/0[.,]0120/)).toHaveCount(0);
  const horizontal = await page.evaluate(
    () => document.documentElement.scrollWidth > window.innerWidth,
  );
  expect(horizontal).toBe(false);
  const axe = await new AxeBuilder({ page })
    .include("main")
    .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
    .analyze();
  expect(axe.violations).toEqual([]);
  if (process.platform === "linux" && process.arch === "x64")
    await expect(page).toHaveScreenshot("usage-models.png", { fullPage: true });
  const smallModel = panel
    .locator("details")
    .filter({ hasText: "openai/gpt-4o-mini" });
  await smallModel.locator("summary").focus();
  await smallModel.locator("summary").press("Enter");
  await expect(
    smallModel
      .getByText(
        /Reported tokens \(in \/ out\)|Tokens informados \(entrada \/ saída\)/,
      )
      .first(),
  ).toBeVisible();
  await expect(
    smallModel.getByText(/Tempo de resposta P95|P95 response time/),
  ).toBeVisible();
  await panel
    .getByText(
      /How these costs are calculated|Como estes custos são calculados/,
    )
    .click();
  await expect(
    panel.getByText(
      /not a full provider invoice|não representa a fatura completa/,
    ),
  ).toBeVisible();
  const downloadEvent = page.waitForEvent("download");
  await panel
    .getByRole("button", { name: /Export metrics|Exportar métricas/ })
    .click();
  const download = await downloadEvent,
    path = await download.path();
  expect(path).not.toBeNull();
  const raw = await readFile(path!, "utf8"),
    report = JSON.parse(raw);
  expect(raw).not.toContain("must-not-export");
  expect(report.summary.models).toHaveLength(2);
  expect(report.summary.effectiveCostUsd).toBe(0.01);
  expect(report.coverage).toBe("recorded_answer_operations");
  const period = panel.getByRole("combobox", {
    name: /Usage period|Período de uso/,
  });
  await period.click();
  await page
    .getByRole("option", { name: /Last 7 days|Últimos 7 dias/ })
    .click();
  await expect(
    panel.getByText(
      /No answer operations were recorded|Nenhuma operação de resposta foi registrada/,
    ),
  ).toBeVisible();
  await expect(
    panel.getByRole("button", { name: /Export metrics|Exportar métricas/ }),
  ).toBeDisabled();
  await period.click();
  await page
    .getByRole("option", { name: /Last 90 days|Últimos 90 dias/ })
    .click();
  await expect(panel.getByRole("alert")).toBeVisible();
  reject90 = false;
  await panel
    .getByRole("button", { name: /Try again|Tentar novamente/ })
    .click();
  await expect(
    panel.getByText("openai/gpt-4o-mini", { exact: true }),
  ).toBeVisible();
  expect(requested).toEqual(expect.arrayContaining([30, 7, 90]));
});

test("expanded AI coverage explains unpriced operations and exports truthful provenance", async ({
  page,
  context,
}) => {
  await workspaceFixture().attach(context);
  await context.route("**/v1/admin/usage?*", (route) => {
    const data = response(30);
    return route.fulfill({
      json: {
        ...data,
        summary: {
          ...data.summary,
          extendedSince: "2026-11-07T12:00:00.000Z",
          unpricedRequests: 2,
        },
      },
    });
  });
  await page.goto("/workspace/usage");
  const panel = page.getByRole("region", { name: /^(AI usage|Uso de IA)$/ });
  await expect(
    panel.getByText(
      /Recorded calls now include embeddings|Os registros atuais incluem embeddings/,
    ),
  ).toBeVisible();
  await expect(
    panel.getByText(
      /Some calls have no reported cost|Algumas chamadas não têm custo informado/,
    ),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth > window.innerWidth,
    ),
  ).toBe(false);
  const axe = await new AxeBuilder({ page })
    .include("main")
    .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
    .analyze();
  expect(axe.violations).toEqual([]);
  const waiting = page.waitForEvent("download");
  await panel
    .getByRole("button", { name: /Export metrics|Exportar métricas/ })
    .click();
  const file = await waiting,
    path = await file.path();
  const report = JSON.parse(await readFile(path!, "utf8"));
  expect(report.coverage).toBe("recorded_provider_operations");
  expect(report.summary.unpricedRequests).toBe(2);
});
