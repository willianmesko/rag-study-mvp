import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page, type TestInfo } from "@playwright/test";
import { workspaceFixture } from "./workspace-fixture";

const compactEmail = "editor@example.test";

async function checkLayout(page: Page, testInfo: TestInfo) {
  await expect(page.locator("html")).toHaveAttribute("lang", testInfo.project.name === "mobile-pt" ? "pt-BR" : "en");
  const size = await page.evaluate(() => ({ viewport: document.documentElement.clientWidth, content: document.documentElement.scrollWidth }));
  expect(size.content, "Page must fit the viewport without horizontal scrolling").toBeLessThanOrEqual(size.viewport);
  const axe = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
  await testInfo.attach("axe-audit", { body: JSON.stringify(axe, null, 2), contentType: "application/json" });
  expect(axe.violations.map(({ id, nodes }) => ({ rule: id, elements: nodes.map(({ target, failureSummary }) => ({ target, failureSummary })) }))).toEqual([]);
}

async function matchReference(page: Page, testInfo: TestInfo, project: string, name: string) {
  // Pixel comparisons use the same Linux x64 image locally and in CI.
  if (process.platform === "linux" && process.arch === "x64" && testInfo.project.name === project) {
    await expect(page).toHaveScreenshot(name, { fullPage: true });
  }
}

test("sign-in fits the viewport and meets automated accessibility checks", async ({ page, context }, testInfo) => {
  await context.route("https://fixture.supabase.co/**", (route) => route.abort());
  await page.goto("/sign-in");
  await expect(page.getByRole("heading", { name: /Sign in to Lumora|Entre no Lumora/ })).toBeVisible();
  await checkLayout(page, testInfo);
  await matchReference(page, testInfo, "desktop-en", "sign-in.png");
});

test("Milo's setup guide fits the viewport and meets automated accessibility checks", async ({ page, context }, testInfo) => {
  await workspaceFixture(null).attach(context);
  await page.goto("/onboarding");
  await expect(page.getByRole("heading", { level: 1, name: /Milo/ })).toBeVisible();
  await expect(page.getByRole("radio", { name: /^(Legal|Jurídico)/ })).toBeVisible();
  await checkLayout(page, testInfo);
  await matchReference(page, testInfo, "mobile-pt", "milo-setup.png");
});

test("team controls fit the viewport and meet automated accessibility checks", async ({ page, context }, testInfo) => {
  await workspaceFixture().attach(context);
  await page.goto("/workspace/team");
  await expect(page.getByRole("heading", { name: /Workspace members|Pessoas no espaço/ })).toBeVisible();
  await expect(page.getByText(compactEmail, { exact: true })).toBeVisible();
  await checkLayout(page, testInfo);
  await matchReference(page, testInfo, "tablet-en", "team.png");
});

test("enabled buttons have hover and keyboard focus, disabled buttons stay inactive", async ({ page, context }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop-en", "Pointer and keyboard checks use the desktop profile.");
  await page.goto("/sign-in");
  const signIn = page.getByRole("button", { name: "Sign in", exact: true });
  await expect(signIn).toHaveCSS("cursor", "pointer");
  const restingBox = await signIn.boundingBox();
  expect(restingBox).not.toBeNull();
  const background = await signIn.evaluate((element) => getComputedStyle(element).backgroundColor);
  await signIn.hover();
  await expect.poll(() => signIn.evaluate((element) => getComputedStyle(element).backgroundColor)).not.toBe(background);
  expect(await signIn.boundingBox(), "Hover should keep the button in place").toEqual(restingBox);
  await page.getByRole("button", { name: "Show password" }).press("Tab");
  await expect(signIn).toBeFocused();
  expect(await signIn.evaluate((element) => element.matches(":focus-visible"))).toBe(true);
  await expect(signIn).toHaveCSS("outline-style", "solid");
  await expect(signIn).toHaveCSS("outline-width", "2px");
  expect(await signIn.boundingBox(), "Keyboard focus should keep the button in place").toEqual(restingBox);

  await workspaceFixture().attach(context);
  await page.goto("/ask");
  const ask = page.getByRole("button", { name: "Send message", exact: true });
  await expect(ask).toBeDisabled();
  await expect(ask).toHaveCSS("cursor", "not-allowed");
  const disabledBackground = await ask.evaluate((element) => getComputedStyle(element).backgroundColor);
  await ask.hover();
  await expect(ask).toHaveCSS("background-color", disabledBackground);
  await page.locator("textarea").fill("What is our team policy?");
  await expect(ask).toBeEnabled();
  await expect(ask).toHaveCSS("cursor", "pointer");
});

test("team management guards duplicate invitations and confirms changes", async ({ page, context }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop-en", "The management journey is covered in the desktop profile.");
  const fixture = workspaceFixture();
  await fixture.attach(context);
  await page.goto("/workspace/team");
  await expect(page.getByText(compactEmail, { exact: true })).toBeVisible();

  const email = page.getByRole("textbox", { name: "Email address" });
  await email.fill(compactEmail.toUpperCase());
  await expect(page.getByRole("alert")).toContainText("This person already has access.");
  await expect(page.getByRole("button", { name: "Send invitation" })).toBeDisabled();
  await email.press("Enter");
  expect(fixture.changes.invitations).toHaveLength(0);

  await page.getByRole("button", { name: `Change role for ${compactEmail}` }).click();
  const roleDialog = page.getByRole("dialog", { name: "Change role" });
  const save = roleDialog.getByRole("button", { name: "Save role" });
  await expect(save).toBeDisabled();
  await roleDialog.getByRole("radio", { name: "Viewer", exact: true }).check();
  await expect(save).toBeEnabled();
  expect(fixture.changes.updated).toHaveLength(0);
  await save.click();
  await expect(roleDialog).toBeHidden();
  await expect(page.getByText(`Role updated for ${compactEmail}.`)).toBeVisible();
  expect(fixture.changes.updated).toHaveLength(1);

  const remove = page.getByRole("button", { name: `Remove access for ${compactEmail}` });
  await remove.press("Enter");
  const confirmation = page.getByRole("dialog", { name: "Remove access" });
  await expect(confirmation).toBeVisible();
  await expect(confirmation.getByRole("button", { name: "Cancel" })).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(confirmation).toBeHidden();
  await expect(remove).toBeFocused();
  expect(fixture.changes.deleted).toHaveLength(0);

  await remove.click();
  await confirmation.getByRole("button", { name: "Remove access", exact: true }).click();
  await expect(confirmation).toBeHidden();
  await expect(page.getByText(compactEmail, { exact: true })).toHaveCount(0);
  expect(fixture.changes.deleted).toHaveLength(1);
});

test("the Milo guide resumes in a second browser context", async ({ page, browser, context, baseURL }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop-en", "The synchronization journey starts in the desktop profile.");
  const fixture = workspaceFixture(null);
  await fixture.attach(context);
  await page.goto("/onboarding");
  const legal = page.getByRole("radio", { name: /^Legal/ });
  await legal.click();
  await expect(legal).toBeChecked();
  const saved = page.waitForResponse((response) => response.request().method() === "PATCH" && response.url().endsWith("/onboarding") && response.request().postDataJSON().step === "knowledge");
  await page.getByRole("button", { name: "Continue" }).click();
  expect((await saved).ok()).toBe(true);
  await expect(page.getByText("Step 2 of 3")).toBeVisible();

  const secondContext = await browser.newContext({ baseURL, locale: "en-US", timezoneId: "UTC" });
  try {
    await fixture.attach(secondContext);
    const second = await secondContext.newPage();
    await second.goto("/onboarding");
    await expect(second.getByText("Step 2 of 3")).toBeVisible();
    await expect(second.getByText("An approved checklist for opening a new matter")).toBeVisible();
    await second.getByRole("button", { name: "Continue" }).click();
    const completed = second.waitForResponse((response) => response.request().method() === "PATCH" && response.url().endsWith("/onboarding") && response.request().postDataJSON().completed === true);
    await second.getByRole("button", { name: "Finish and open workspace" }).click();
    expect((await completed).ok()).toBe(true);
    await expect(second).toHaveURL(/\/workspace\/overview$/);
    await page.reload();
    await expect(page).toHaveURL(/\/workspace\/overview$/);
  } finally {
    await secondContext.close();
  }
});
