import { fileURLToPath } from "node:url";
import { build } from "vite";
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type BrowserContext, type Page } from "@playwright/test";

let bundle: string;
test.beforeAll(async () => {
  const result = await build({ configFile: false, publicDir: false, logLevel: "silent",
    esbuild: { jsx: "automatic" }, define: { "process.env.NODE_ENV": '"production"', "import.meta.env.VITE_API_BASE_URL": '""' },
    build: { write: false, minify: false, lib: { entry: fileURLToPath(new URL("./fixtures/primitives.tsx", import.meta.url)), formats: ["iife"], name: "PrimitivesFixture" } },
  });
  const output = (Array.isArray(result) ? result[0] : result) as import("rollup").RollupOutput;
  bundle = output.output.filter((asset) => asset.type === "chunk").map((asset) => asset.code).join("\n");
});

async function openFixture(page: Page, context: BrowserContext) {
  const html = await (await page.request.get("/")).text();
  const style = html.match(/href="([^"]+\.css)"/)![1];
  await context.route("**/__fixtures/primitives.js", (route) => route.fulfill({ contentType: "application/javascript; charset=utf-8", body: bundle }));
  await context.route("**/__fixtures/primitives", (route) => route.fulfill({ contentType: "text/html; charset=utf-8",
    body: `<!doctype html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Primitives</title><link rel="stylesheet" href="${style}"></head><body><div id="root"></div><script src="/__fixtures/primitives.js"></script></body></html>` }));
  await page.goto("/__fixtures/primitives");
  await expect(page.getByRole("heading", { name: "Interaction fixture" })).toBeVisible();
}
async function audit(page: Page) {
  const result = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
  expect(result.violations.map(({ id, nodes }) => ({ id, targets: nodes.map(({ target }) => target) }))).toEqual([]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
}
async function trackFiles(context: BrowserContext) {
  await context.addInitScript(() => {
    const create = URL.createObjectURL, revoke = URL.revokeObjectURL, original = window.fetch;
    const files = { created: [] as string[], revoked: [] as string[], aborted: 0 };
    Object.assign(window, { fixtureFiles: files });
    URL.createObjectURL = (blob) => { const url = create(blob); files.created.push(url); return url; };
    URL.revokeObjectURL = (url) => { files.revoked.push(url); revoke(url); };
    window.fetch = (input, init) => {
      if (String(input).endsWith("/original")) init?.signal?.addEventListener("abort", () => { files.aborted++; }, { once: true });
      return original(input, init);
    };
  });
}
const files = (page: Page) => page.evaluate(() => (window as unknown as { fixtureFiles: { created: string[]; revoked: string[]; aborted: number } }).fixtureFiles);
const opener = (page: Page) => page.getByRole("button", { name: /Original file for|Arquivo original de/ });
const originalDialog = (page: Page) => page.getByRole("dialog", { name: /^(Original file|Arquivo original)$/ });
const download = (page: Page) => page.getByRole("link", { name: /Download original|Baixar original/ });

// The actual shared primitives and production stylesheet are bundled into a test-only page.
test("FE-09 action variants share focus, disabled and pending behavior without layout shift", async ({ page, context }) => {
  await openFixture(page, context);
  for (const variant of ["primary", "secondary", "danger"]) {
    const action = page.getByRole("button", { name: `${variant} action`, exact: true });
    const disabled = page.getByRole("button", { name: `${variant} disabled`, exact: true });
    const pending = page.getByRole("button", { name: `${variant} pending`, exact: true });
    await expect(action).toHaveCSS("cursor", "pointer");
    await expect(disabled).toHaveCSS("cursor", "not-allowed");
    await expect(pending).toHaveCSS("cursor", "progress");
    const color = await disabled.evaluate((el) => getComputedStyle(el).backgroundColor);
    await disabled.hover(); await expect(disabled).toHaveCSS("background-color", color);
    await disabled.evaluate((el) => el.click());
    await expect(page.getByRole("status", { name: "Action count" })).toHaveText("0");
    const box = await action.boundingBox();
    await action.focus(); await page.keyboard.press("Tab"); await page.keyboard.press("Shift+Tab");
    await expect(action).toBeFocused();
    expect(await action.evaluate((el) => el.matches(":focus-visible"))).toBe(true);
    await expect(action).toHaveCSS("outline-width", "2px");
    expect(await action.boundingBox()).toEqual(box);
    await expect(action).toHaveCSS("transition-duration", "1e-05s");
  }
  await audit(page);
});

test("FE-09 enabled actions and links use hover tokens", async ({ page, context }, info) => {
  test.skip(info.project.name !== "desktop-en", "Pointer hover is verified on the pointer profile.");
  await openFixture(page, context);
  for (const name of ["primary action", "secondary action", "danger action"]) {
    const action = page.getByRole("button", { name, exact: true });
    const before = await action.evaluate((el) => getComputedStyle(el).backgroundColor), box = await action.boundingBox();
    await action.hover(); await expect.poll(() => action.evaluate((el) => getComputedStyle(el).backgroundColor)).not.toBe(before);
    expect(await action.boundingBox()).toEqual(box);
  }
  const link = page.getByRole("link", { name: "Text link" }), before = await link.evaluate((el) => getComputedStyle(el).color);
  await link.hover(); await expect.poll(() => link.evaluate((el) => getComputedStyle(el).color)).not.toBe(before);
});

test("FE-09 Radix select and menu stay inside the modal and preserve Escape and focus ownership", async ({ page, context }) => {
  await openFixture(page, context);
  const open = page.getByRole("button", { name: "Open controls" }); await open.press("Enter");
  const dialog = page.getByRole("dialog", { name: "Fixture controls" });
  const select = dialog.getByRole("combobox", { name: "Fixture selection" });
  await select.press("ArrowDown");
  await expect(dialog.getByRole("listbox")).toBeVisible();
  await expect(dialog.getByRole("option", { name: "Unavailable", exact: true })).toBeDisabled();
  await expect(dialog.getByRole("option", { name: "Alpha", exact: true })).toBeFocused();
  await page.keyboard.press("ArrowDown");
  await expect(dialog.getByRole("option", { name: "Gamma", exact: true })).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(select).toContainText("Gamma"); await expect(select).toBeFocused();
  await select.press("ArrowDown"); await page.keyboard.press("Escape");
  await expect(dialog.getByRole("listbox")).toHaveCount(0); await expect(select).toBeFocused(); await expect(dialog).toBeVisible();
  const actions = dialog.getByRole("button", { name: "Fixture actions" }); await actions.press("Enter");
  await expect(dialog.getByRole("menu")).toBeVisible();
  await expect(dialog.getByRole("menuitem", { name: "Unavailable action" })).toBeDisabled();
  await expect(dialog.getByRole("menuitem", { name: "Inspect", exact: true })).toBeFocused();
  await audit(page);
  await expect(dialog.getByRole("menuitem", { name: "Inspect", exact: true })).toBeFocused();
  await page.keyboard.press("Escape"); await expect(actions).toBeFocused(); await expect(dialog).toBeVisible();
  await page.keyboard.press("Escape"); await expect(dialog).toBeHidden(); await expect(open).toBeFocused();
  await expect(page.getByRole("status", { name: "Closed count" })).toHaveText("1");
});

test("FE-09 a busy overlay blocks dismissal and native close updates controlled state once", async ({ page, context }) => {
  await openFixture(page, context);
  await page.getByRole("button", { name: "Open controls" }).click();
  const dialog = page.getByRole("dialog", { name: "Fixture controls" });
  await dialog.getByRole("button", { name: "Start work" }).click();
  await expect(dialog).toHaveAttribute("aria-busy", "true");
  await expect(dialog.getByRole("button", { name: /^(Close|Fechar)$/ })).toBeDisabled();
  await page.keyboard.press("Escape"); await expect(dialog).toBeVisible();
  await page.evaluate(() => window.dispatchEvent(new Event("fixture-finished")));
  await expect(dialog.getByRole("button", { name: /^(Close|Fechar)$/ })).toBeEnabled();
  await dialog.evaluate((el: HTMLDialogElement) => el.close());
  await expect(dialog).toHaveCount(0); await expect(page.getByRole("status", { name: "Closed count" })).toHaveText("1");
});

test("FE-09 original URLs retire on replacement, close and unmount with scoped requests", async ({ page, context }) => {
  await trackFiles(context);
  await context.route("**/v1/admin/documents/*/original", (route) => {
    expect(route.request().headers()).toMatchObject({ authorization: "Bearer fixture-file-token", "x-workspace-id": "fixture-workspace" });
    return route.fulfill({ contentType: "application/pdf", headers: { "content-disposition": `attachment; filename*=UTF-8''${new URL(route.request().url()).pathname.split("/").at(-2)}.pdf` }, body: "%PDF-1.4\nfixture" });
  });
  await openFixture(page, context); await opener(page).press("Enter");
  await expect(download(page)).toHaveAttribute("download", "document-a.pdf");
  const a = await download(page).getAttribute("href");
  await page.evaluate(() => window.dispatchEvent(new Event("fixture-document")));
  await expect(download(page)).toHaveAttribute("download", "document-b.pdf");
  expect((await files(page)).revoked).toEqual([a]);
  await audit(page); await page.keyboard.press("Escape");
  await expect(originalDialog(page)).toHaveCount(0); await expect(opener(page)).toBeFocused();
  expect((await files(page)).revoked).toEqual((await files(page)).created);
  await opener(page).click(); await expect(download(page)).toBeVisible();
  await page.getByRole("button", { name: /^(Close|Fechar)$/ }).click();
  expect((await files(page)).created).toHaveLength(3);
  expect((await files(page)).revoked).toEqual((await files(page)).created);
});

test("FE-09 closing during a file read aborts it and cannot create a late URL", async ({ page, context }) => {
  await trackFiles(context);
  let release!: () => void, reads = 0;
  const held = new Promise<void>((resolve) => { release = resolve; });
  await context.route("**/v1/admin/documents/*/original", async (route) => {
    reads++; await held;
    return route.fulfill({ contentType: "application/pdf", body: "%PDF-1.4\nfixture" });
  });
  try {
    await openFixture(page, context); await opener(page).click();
    await expect.poll(() => reads).toBe(1);
    await expect(originalDialog(page).getByRole("status")).toBeVisible();
    await page.keyboard.press("Escape");
    await expect.poll(async () => (await files(page)).aborted).toBe(1);
    release();
    await expect(originalDialog(page)).toHaveCount(0);
    expect((await files(page)).created).toEqual([]); expect((await files(page)).revoked).toEqual([]);
  } finally { release(); }
});

test("FE-09 file retry rejects active HTML and creates only the successful download URL", async ({ page, context }) => {
  await trackFiles(context); let reads = 0;
  await context.route("**/v1/admin/documents/*/original", (route) => {
    reads++;
    return reads === 1 ? route.fulfill({ contentType: "text/html", body: '<script>window.unsafePreview=true</script>' })
      : route.fulfill({ contentType: "application/pdf", body: "%PDF-1.4\nfixture" });
  });
  await openFixture(page, context); await opener(page).click();
  await expect(originalDialog(page).getByRole("alert")).toBeVisible();
  expect((await files(page)).created).toEqual([]);
  await originalDialog(page).getByRole("button", { name: /^(Try again|Tentar novamente)$/ }).click();
  await expect(download(page)).toBeVisible(); expect((await files(page)).created).toHaveLength(1);
  await page.keyboard.press("Escape");
  expect((await files(page)).revoked).toEqual((await files(page)).created);
  expect(await page.evaluate(() => "unsafePreview" in window)).toBe(false);
});

test("FE-09 source disclosures keep previews escaped and similarity distinct from certainty", async ({ page, context }, info) => {
  await openFixture(page, context);
  const evidence = page.getByRole("region", { name: /Document evidence|Trechos dos documentos/ });
  await evidence.getByText(/^(Read excerpt|Ler trecho)$/).first().press("Enter");
  await expect(evidence.getByText('<img src=x onerror="window.unsafePreview=true">', { exact: true })).toBeVisible();
  await expect(evidence.locator("img")).toHaveCount(0);
  await expect(evidence.getByRole("region", { name: /Validated citations|Citações validadas/ }).getByText(/Cosine similarity 0.875|Similaridade cosseno 0,875/)).toBeVisible();
  await expect(evidence.getByText(/A close match can still contain an error|Mesmo um trecho muito semelhante pode conter um erro/)).toBeVisible();
  await audit(page);
  expect(await page.evaluate(() => "unsafePreview" in window)).toBe(false);
  await expect(page.locator("html")).toHaveAttribute("lang", info.project.name === "mobile-pt" ? "pt-BR" : "en");
});
