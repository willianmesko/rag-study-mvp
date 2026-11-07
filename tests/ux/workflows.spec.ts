import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import { workspaceFixture } from "./workspace-fixture";
const workspaceId = "11111111-1111-4111-a111-111111111111",
  runId = "38890ca1-1570-484c-a07e-338fc30d8c61";
test("owner can review a durable evaluation budget, approve and cancel accessibly", async ({
  page,
  context,
}, info) => {
  await workspaceFixture().attach(context);
  let status = "waiting_approval";
  const actions: string[] = [];
  const workflow = () => ({
    runId,
    kind: "evaluation",
    version: "evaluation-v2",
    status,
    stage: status === "waiting_approval" ? "approval" : "retrieve_cases",
    steps: 1,
    calls: 0,
    inputTokens: 0,
    outputTokens: 0,
    costMicros: 0,
    budget: {
      maxSteps: 50,
      maxCalls: 32,
      maxInputTokens: 500000,
      maxOutputTokens: 16000,
      maxCostMicros: 200000,
      timeoutMs: 120000,
    },
    attempts: 1,
    errorCode: null,
    resultId: null,
    createdAt: "2026-11-07T12:00:00.000Z",
    updatedAt: "2026-11-07T12:00:00.000Z",
    expiresAt: "2026-11-08T12:00:00.000Z",
  });
  await context.route("**/v1/admin/evaluations?*", (route) =>
    route.fulfill({
      json: {
        runs: [],
        workflowAvailable: true,
        workflows: [workflow()],
        faithfulnessEnabled: true,
      },
    }),
  );
  await context.route("**/v1/admin/evaluation-workflows/*/*", (route) => {
    expect(route.request().headers()["x-workspace-id"]).toBe(workspaceId);
    const action = route.request().url().split("/").at(-1)!;
    actions.push(action);
    status = action === "approve" ? "running" : "cancelled";
    return route.fulfill({ json: { workflow: workflow() } });
  });
  await page.goto("/workspace/evaluations");
  const progress = page.getByRole("region", {
    name: /Evaluation progress|Progresso das avaliações/,
  });
  await expect(
    progress.getByText(/Waiting for your approval|Aguardando sua aprovação/),
  ).toBeVisible();
  await expect(
    progress.getByText(
      /Reservations are conservative estimates|As reservas são estimativas/,
    ),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: /^(Run evaluation|Executar avaliação)$/ }),
  ).toBeDisabled();
  const a11y = await new AxeBuilder({ page })
    .include("main")
    .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
    .analyze();
  expect(a11y.violations).toEqual([]);
  if (process.platform === "linux" && process.arch === "x64")
    await expect(page).toHaveScreenshot("evaluation-approval.png", {
      fullPage: true,
    });
  await progress
    .getByRole("button", { name: /Approve and continue|Aprovar e continuar/ })
    .click();
  await expect(
    progress.getByText(
      /Finding reference passages|Buscando trechos de referência/,
    ),
  ).toBeVisible();
  await progress
    .getByRole("button", { name: /Cancel evaluation|Cancelar avaliação/ })
    .click();
  await expect(progress.getByText(/^(Cancelled|Cancelada)$/)).toBeVisible();
  expect(actions).toEqual(["approve", "cancel"]);
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth > window.innerWidth,
  );
  expect(overflow).toBe(false);
});
