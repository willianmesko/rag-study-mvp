import { parseArgs } from "node:util";
import { z } from "zod";
import type { EmbeddingProvider } from "../../modules/ai/application/ports/embedding-provider.js";
import { workspaceEmbeddingDimensions, type EmbeddingModelIdentity } from "../../modules/ai/application/ports/workspace-embedding-index.js";
import { rebuildWorkspaceEmbeddings } from "../../modules/knowledge/application/use-cases/rebuild-workspace-embeddings.js";
import { config } from "../../config.js";
import { createWorkspaceEmbeddingAdapter } from "../../modules/ai/index.js";
import { createConfiguredProviderBindings } from "../../app/composition/provider-registry.js";
import { PgWorkspaceEmbeddingIndex } from "../../modules/ai/infrastructure/postgres/pg-workspace-embedding-index.js";
import { createPostgresPool } from "../../platform/database/pool.js";

const actions = z.enum(["status", "pin", "stage", "activate", "rollback", "discard"]);
const uuid = z.uuid();
const identity = z.object({
  provider: z.enum(["ollama", "openrouter", "bedrock"]),
  model: z.string().min(1).max(200).regex(/^[A-Za-z0-9._:/-]+$/)
});

const help = `Usage: npm run embedding:index -- <action> --workspace <uuid>
  status
  pin [--provider <provider> --model <known-existing-model>]
  stage --provider <provider> --model <target-model> [--max-chunks <count>] [--allow-external-provider]
  activate --version <uuid>
  rollback --version <uuid>
  discard --version <uuid>`;

const providerBindings = createConfiguredProviderBindings(config);

function operatorProvider(model: EmbeddingModelIdentity): EmbeddingProvider {
  const adapter = createWorkspaceEmbeddingAdapter(model, providerBindings.registry);
  return {
    async embed(text, type, signal) {
      try {
        return await adapter.embed(text, type, signal);
      } catch {
        throw new Error(`The ${model.provider} model could not return a valid ${model.dimensions}-dimensional ${type} embedding.`);
      }
    }
  };
}

async function main(): Promise<void> {
  const { positionals, values } = parseArgs({ allowPositionals: true, options: {
    workspace: { type: "string" }, provider: { type: "string" }, model: { type: "string" },
    version: { type: "string" }, "max-chunks": { type: "string" }, "allow-external-provider": { type: "boolean" }, help: { type: "boolean" }
  } });
  if (values.help) { console.log(help); return; }
  if (positionals.length !== 1) throw new Error(help);
  const action = actions.parse(positionals[0]);
  const tenantId = uuid.parse(values.workspace);
  const pool = createPostgresPool(config.DATABASE_URL, 10, "maintenance");
  const index = new PgWorkspaceEmbeddingIndex(pool);
  const signal = AbortSignal.timeout(10 * 60_000);

  try {
    switch (action) {
      case "status":
        console.log(JSON.stringify({ workspaceId: tenantId, versions: await index.status(tenantId) }, null, 2));
        break;
      case "pin": {
        const model = values.provider || values.model
          ? { ...identity.parse(values), dimensions: workspaceEmbeddingDimensions }
          : providerBindings.defaultEmbedding;
        const pinned = await index.getOrPinActive(tenantId, model);
        if (pinned.provider !== model.provider || pinned.model !== model.model) throw new Error("A different model is already pinned. Use an explicit rebuild to switch models.");
        console.log(JSON.stringify(pinned, null, 2));
        break;
      }
      case "stage": {
        const model = { ...identity.parse(values), dimensions: workspaceEmbeddingDimensions };
        if (model.provider !== "ollama" && !values["allow-external-provider"]) {
          throw new Error("Staging with an external provider requires --allow-external-provider. Review your workspace's data policy before proceeding.");
        }
        const maxChunks = z.coerce.number().int().min(1).max(1_000).parse(values["max-chunks"] ?? 100);
        const adapter = operatorProvider(model);
        await adapter.embed("Workspace embedding index probe.", "query", signal);
        await adapter.embed("Workspace embedding index probe.", "document", signal);
        await index.getOrPinActive(tenantId, providerBindings.defaultEmbedding);
        const target = await index.startBuild(tenantId, model);
        console.log(JSON.stringify({ stagingVersion: target.id }));
        const result = await rebuildWorkspaceEmbeddings(index, adapter, { tenantId, versionId: target.id, maxChunks, signal });
        console.log(JSON.stringify({ ...result, versions: await index.status(tenantId) }, null, 2));
        break;
      }
      case "activate":
      case "rollback": {
        const versionId = uuid.parse(values.version);
        const state = action === "activate" ? "building" : "previous";
        const target = (await index.status(tenantId)).find((version) => version.id === versionId && version.state === state);
        if (!target) throw new Error("The requested version is not available for this operation in the workspace.");
        await operatorProvider(target).embed("Workspace embedding index probe.", "query", signal);
        console.log(JSON.stringify(await index.switchActive(tenantId, versionId, action), null, 2));
        break;
      }
      case "discard":
        await index.discardBuild(tenantId, uuid.parse(values.version));
        console.log("Discarded the staged workspace embedding version.");
    }
  } finally {
    await pool.end();
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof z.ZodError ? help : error instanceof Error ? error.message : "Embedding index operation failed.");
  process.exitCode = 1;
});
