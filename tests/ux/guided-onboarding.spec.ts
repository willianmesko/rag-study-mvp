import AxeBuilder from "@axe-core/playwright";
import { expect, test, type BrowserContext } from "@playwright/test";
import { workspaceFixture } from "./workspace-fixture";

const workspaceId = "11111111-1111-4111-a111-111111111111";
const workspace = { tenantId: workspaceId, tenantName: "Northstar Studio", tenantSlug: "northstar-studio", role: "owner" };
const headers = { authorization: "Bearer fixture-workspace-token", "x-workspace-id": workspaceId };
const date = "2026-11-07T00:00:00.000Z";

async function answerModel(context: BrowserContext) {
  await context.route("**/v1/qa/models", (route) => route.fulfill({ json: {
    models: [{ id: "default", label: "Workspace model", provider: "openrouter", isDefault: true }], comparisonAvailable: false
  } }));
}

test("a new team can create a workspace, prepare a sample, ask a real question, and inspect its source", async ({ page, context }, info) => {
  const pt = info.project.name === "mobile-pt";
  await workspaceFixture(null).attach(context);
  let created = false;
  let preparationReads = 0;
  let job: Record<string, unknown> | null = null;
  let uploaded = 0;
  let questions = 0;
  let releaseAnswer!: () => void;
  const answerReady = new Promise<void>((resolve) => { releaseAnswer = resolve; });
  const filename = pt ? "exemplo-checklist-solicitacoes.md" : "sample-request-checklist.md";
  const title = pt ? "Exemplo de checklist de solicitações" : "Sample request checklist";
  const source = `onboarding/templates/${filename}`;
  const question = pt ? "O que preciso antes de enviar uma solicitação?" : "What do I need before submitting a request?";
  const answer = pt ? "Inclua uma breve descrição, o resultado esperado e a aprovação da pessoa responsável." : "Include a short description, the expected outcome, and the responsible person's approval.";
  const passage = { chunkId: "starter-passage-1", documentId: "starter-document", source, title, chunk: 1, score: 0.81, excerpt: answer };

  await context.route("**/v1/workspaces", async (route) => {
    expect(route.request().headers().authorization).toBe(headers.authorization);
    if (route.request().method() === "POST") {
      expect(route.request().postDataJSON()).toMatchObject({ name: workspace.tenantName, slug: expect.stringMatching(/^northstar-studio-/) });
      created = true;
      return route.fulfill({ status: 201, json: { workspace } });
    }
    return route.fulfill({ json: { workspaces: created ? [workspace] : [] } });
  });
  await context.route("**/v1/admin/uploads", async (route) => {
    expect(route.request().headers()).toMatchObject(headers);
    if (route.request().method() === "POST") {
      uploaded++;
      expect(route.request().headers()["x-document-source"]).toBe(source);
      expect(route.request().postDataBuffer()!.toString("utf8")).toContain(filename);
      job = { id: "guide-job", source, title, filename, mimeType: "text/markdown", status: "queued", progress: 0, error: null, chunkCount: null, highRiskChunks: null, createdAt: date, updatedAt: date };
      return route.fulfill({ status: 202, json: { job } });
    }
    if (job) {
      preparationReads++;
      job = { ...job, status: preparationReads > 1 ? "completed" : "processing", progress: preparationReads > 1 ? 100 : 45, chunkCount: preparationReads > 1 ? 4 : null };
    }
    return route.fulfill({ json: { jobs: job ? [job] : [] } });
  });
  await context.route("**/v1/admin/documents", (route) => {
    expect(route.request().headers()).toMatchObject(headers);
    return route.fulfill({ json: { documents: job?.status === "completed" ? [{
      id: "starter-document", source, title, chunkCount: 4, format: "markdown", createdAt: date, updatedAt: date
    }] : [] } });
  });
  await answerModel(context);
  await context.route("**/v1/qa/stream", async (route) => {
    questions++;
    expect(route.request().headers()).toMatchObject(headers);
    expect(route.request().postDataJSON()).toMatchObject({ question, modelId: "default" });
    await answerReady;
    const events = [
      { type: "accepted" }, { type: "retrieving" }, { type: "validating" },
      { type: "completed", response: { answer, citedChunkIds: [passage.chunkId], sources: [passage], contextSources: [passage] } }
    ];
    return route.fulfill({ contentType: "text/event-stream", body: events.map((event, i) => `id: ${i + 1}\nevent: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`).join("") });
  });

  await page.goto("/onboarding");
  await page.getByRole("textbox", { name: /Workspace name|Nome do espaço/ }).fill(workspace.tenantName);
  await page.getByRole("button", { name: /Create workspace and continue|Criar espaço e continuar/ }).click();
  const goal = page.getByRole("radio", { name: /^(Knowledge and processes|Conhecimento e processos)/ });
  await goal.click();
  await expect(goal).toBeChecked();
  await page.getByRole("button", { name: /^(Continue|Continuar)$/ }).click();
  await expect(page.getByText(/Fictional content for practice|Conteúdo fictício para praticar/)).toBeVisible();
  await page.getByRole("button", { name: /Use sample document|Usar documento de exemplo/ }).click();
  await expect(page.getByRole("region", { name: /Document preparation|Preparação do documento/, exact: true })).toContainText(/Ready to use · 4 passages|Pronto para usar · 4 trechos/, { timeout: 12_000 });
  await expect(page.getByRole("button", { name: /Sample already added|Exemplo já adicionado/ })).toBeDisabled();
  await expect(page.getByRole("heading", { name: /Ready for questions|Prontos para perguntas/ })).toBeVisible();
  if (process.platform === "linux" && process.arch === "x64" && info.project.name === "desktop-en") {
    await expect(page).toHaveScreenshot("milo-documents.png", { fullPage: true });
  }
  expect(uploaded).toBe(1);
  await page.getByRole("button", { name: /^(Continue|Continuar)$/ }).click();
  await page.getByRole("button", { name: question, exact: true }).click();
  await page.getByRole("button", { name: /^(Send message|Enviar mensagem)$/ }).click();
  const finish = page.getByRole("button", { name: /Finish and open chat|Concluir e abrir conversa/ });
  await expect(finish).toBeDisabled();
  await expect(page.getByRole("button", { name: /^(Back|Voltar)$/ })).toBeDisabled();
  releaseAnswer();
  const messages = page.getByRole("region", { name: /Conversation messages|Mensagens da conversa/ });
  await expect(messages.getByText(answer, { exact: true })).toBeVisible();
  await messages.getByText(/Read sources and passages|Ler fontes e trechos/).click();
  await messages.getByText(/^(Read excerpt|Ler trecho)$/).first().click();
  await expect(messages.getByText(answer, { exact: true }).last()).toBeVisible();
  await expect(messages.getByText(/Cosine similarity|Similaridade cosseno/).first()).toContainText(pt ? "0,810" : "0.810");
  await page.getByText(/A few terms, in plain language|Alguns termos, com palavras simples/).click();
  await expect(page.getByText(/not a probability that the answer is true|Não é a probabilidade de a resposta ser verdadeira/)).toBeVisible();
  const width = await page.evaluate(() => ({ viewport: document.documentElement.clientWidth, content: document.documentElement.scrollWidth }));
  expect(width.content).toBeLessThanOrEqual(width.viewport);
  const audit = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
  expect(audit.violations.map(({ id, nodes }) => ({ id, elements: nodes.map(({ target }) => target) }))).toEqual([]);
  expect(questions).toBe(1);
  await finish.click();
  await expect(page).toHaveURL(/\/ask$/);
  await page.getByRole("navigation", { name: /Main navigation|Navegação principal/ }).getByRole("button", { name: /^(History|Histórico)$/ }).click();
  await expect(page.getByText(answer, { exact: true }).first()).toBeVisible();
});

test("Help reopens the guide, supports a real owner invitation, and preserves completed setup", async ({ page, context }, info) => {
  test.skip(info.project.name !== "desktop-en", "Help and invitation state use the same component across viewports.");
  await workspaceFixture().attach(context);
  let progressWrites = 0;
  let invitations = 0;
  await context.route("**/v1/admin/uploads", (route) => route.fulfill({ json: { jobs: [{
    id: "old-starter-job", source: "onboarding/templates/sample-request-checklist.md", filename: "sample-request-checklist.md",
    title: "Sample request checklist", mimeType: "text/markdown", status: "completed", progress: 100,
    error: null, chunkCount: 4, highRiskChunks: 0, createdAt: date, updatedAt: date
  }] } }));
  await context.route(`**/v1/workspaces/${workspaceId}/onboarding`, async (route) => {
    if (route.request().method() === "PATCH") progressWrites++;
    await route.fallback();
  });
  await context.route(`**/v1/workspaces/${workspaceId}/invitations`, async (route) => {
    expect(route.request().headers()).toMatchObject(headers);
    expect(route.request().postDataJSON()).toEqual({ email: "teammate@example.test", role: "viewer" });
    invitations++;
    await route.fulfill({ status: 201, json: { member: { userId: "new-member", email: "teammate@example.test", role: "viewer" } } });
  });
  await page.goto("/workspace/overview");
  const help = page.getByRole("button", { name: "Help", exact: true });
  await help.click();
  const guide = page.getByRole("dialog", { name: "Milo’s guide", exact: true });
  await expect(guide.getByText("Step 1 of 3")).toBeVisible();
  await guide.getByRole("radio", { name: /^Knowledge and processes/ }).check();
  await guide.getByRole("button", { name: "Continue", exact: true }).click();
  await expect(guide.getByRole("region", { name: "Document setup", exact: true })).toHaveAttribute("aria-busy", "false");
  await expect(guide.getByRole("button", { name: "Use sample document", exact: true })).toBeEnabled();
  await expect(guide.getByRole("region", { name: "Document preparation", exact: true })).toHaveCount(0);
  await guide.getByText("Bring your team (optional)", { exact: true }).click();
  await guide.getByRole("button", { name: "Invite a teammate", exact: true }).click();
  const invitation = page.getByRole("dialog", { name: "Invite a teammate", exact: true });
  await invitation.getByRole("textbox", { name: "Email address" }).fill("teammate@example.test");
  await invitation.getByRole("button", { name: "Send invitation", exact: true }).click();
  await expect(invitation).toBeHidden();
  await expect(guide.getByText("Invitation sent to teammate@example.test.", { exact: true })).toBeVisible();
  expect(invitations).toBe(1);
  await guide.getByRole("button", { name: "Close", exact: true }).click();
  await expect(guide).toBeHidden();
  await expect(help).toBeFocused();
  expect(progressWrites).toBe(0);
  await page.reload();
  await expect(page).toHaveURL(/\/workspace\/overview$/);
});

test("the guide gives editors and viewers the actions allowed by their role", async ({ browser, baseURL }, info) => {
  test.skip(info.project.name !== "desktop-en", "Role policy is independent of viewport.");
  for (const role of ["editor", "viewer"] as const) {
    const context = await browser.newContext({ baseURL, locale: "en-US", timezoneId: "UTC" });
    try {
      await workspaceFixture({ goal: "support", step: "knowledge", completed: false }).attach(context);
      await context.route("**/v1/workspaces", (route) => route.fulfill({ json: { workspaces: [{ ...workspace, role }] } }));
      const page = await context.newPage();
      await page.goto("/onboarding");
      await expect(page.getByText("Step 2 of 3")).toBeVisible();
      await expect(page.getByRole("button", { name: "Invite a teammate", exact: true })).toHaveCount(0);
      await expect(page.locator('input[type="file"]')).toHaveCount(role === "editor" ? 1 : 0);
      await expect(page.getByRole("button", { name: "Use sample document", exact: true })).toHaveCount(role === "editor" ? 1 : 0);
      await page.getByRole("button", { name: "Finish for now", exact: true }).click();
      await expect(page).toHaveURL(/\/ask$/);
      await expect(page.getByRole("button", { name: "Help", exact: true })).toBeVisible();
    } finally { await context.close(); }
  }
});

test("a personal file can recover from an upload limit without leaving the guide stuck", async ({ page, context }, info) => {
  test.skip(info.project.name !== "desktop-en", "Upload errors and retry state are shared across viewport profiles.");
  await workspaceFixture({ goal: "learning", step: "knowledge", completed: false }).attach(context);
  let attempts = 0;
  const job = { id: "personal-job", source: "onboarding/Team%20handbook.md", title: "Team handbook", filename: "Team handbook.md", mimeType: "text/markdown", status: "completed", progress: 100, error: null, chunkCount: 2, highRiskChunks: 0, createdAt: date, updatedAt: date };
  await context.route("**/v1/admin/uploads", async (route) => {
    if (route.request().method() !== "POST") return route.fulfill({ json: { jobs: [] } });
    expect(route.request().headers()).toMatchObject(headers);
    expect(route.request().headers()["x-document-source"]).toBe(job.source);
    if (++attempts === 1) return route.fulfill({ status: 429, json: { error: "Upload limit reached." } });
    return route.fulfill({ status: 202, json: { job } });
  });
  await context.route("**/v1/admin/documents", (route) => route.fulfill({ json: { documents: attempts > 1 ? [{ id: "personal-doc", source: job.source, title: job.title, chunkCount: 2, createdAt: date, updatedAt: date }] : [] } }));
  await page.goto("/onboarding");
  await page.getByText("Use your own document", { exact: true }).click();
  const input = page.getByLabel("Choose a file (optional)");
  await input.setInputFiles({ name: job.filename, mimeType: "text/markdown", buffer: Buffer.from("# Team handbook\nNew teammates attend orientation on their first day.") });
  const upload = page.getByRole("button", { name: "Upload document", exact: true });
  await upload.click();
  await expect(page.getByRole("alert")).toContainText("You’ve reached a usage limit.");
  await expect(page.getByRole("button", { name: "Continue", exact: true })).toBeEnabled();
  await upload.click();
  await expect(page.getByRole("region", { name: "Document preparation", exact: true })).toContainText("Ready to use · 2 passages");
  await expect(input).toHaveValue("");
  await expect(upload).toBeDisabled();
  expect(attempts).toBe(2);
});
