import { expect, test } from "@playwright/test";
import { accessibleWorkspacePath } from "../../apps/web/src/app/model/route-policy";
import { workspaceFixture } from "./workspace-fixture";

test("application deep-link policy preserves authorized paths and rejects owner sections for readers", () => {
  expect(accessibleWorkspacePath("/workspace/team", "owner")).toBe("/workspace/team");
  expect(accessibleWorkspacePath("/workspace/team", "viewer")).toBe("/workspace/overview");
  expect(accessibleWorkspacePath("/workspace/evaluations", "editor")).toBe("/workspace/overview");
  expect(accessibleWorkspacePath("/workspace/processing", "viewer")).toBe("/workspace/processing");
  const conversation = "aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa";
  expect(accessibleWorkspacePath(`/ask?conversation=${conversation}`, "viewer")).toBe(`/ask?conversation=${conversation}`);
  expect(accessibleWorkspacePath("/ask?conversation=fixture", "viewer")).toBe("/ask");
  expect(accessibleWorkspacePath(`/ask?conversation=${conversation}&question=private`, "viewer")).toBe(`/ask?conversation=${conversation}`);
  expect(accessibleWorkspacePath(null, "owner")).toBe("/ask");
  expect(accessibleWorkspacePath("https://attacker.example/", "owner")).toBe("/workspace/overview");
});

test("application routing restores browser history while preserving the active workspace", async ({ page, context }) => {
  await workspaceFixture().attach(context);
  await page.goto("/workspace/team");
  await expect(page.getByText("owner@example.test", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: /^(Overview|Visão geral)$/ }).click();
  await expect(page).toHaveURL(/\/workspace\/overview$/);
  await page.goBack();
  await expect(page).toHaveURL(/\/workspace\/team$/);
  await expect(page.getByText("owner@example.test", { exact: true })).toBeVisible();
  await page.goForward();
  await expect(page.getByRole("heading", { name: /^(Overview|Visão geral)$/ })).toBeVisible();
});
