import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { randomBytes } from "node:crypto";
import { promisify } from "node:util";
import { resolve } from "node:path";
import { isIP } from "node:net";
import { fixtureModel } from "./fixtures.mjs";

const execute = promisify(execFile);
export async function docker(args, input) {
  if (input !== undefined) {
    return new Promise((resolveResult, reject) => {
      const child = execFile("docker", args, { encoding: "utf8", timeout: 120_000, maxBuffer: 2 * 1024 * 1024 },
        (error, stdout) => error ? reject(new Error("Capacity Docker operation failed.")) : resolveResult(stdout));
      child.stdin.on("error", () => {}); child.stdin.end(input);
    });
  }
  try { return (await execute("docker", args, { encoding: "utf8", timeout: 120_000, maxBuffer: 2 * 1024 * 1024 })).stdout; }
  catch { throw new Error("Capacity Docker operation failed."); }
}
export function assertImage(image) {
  assert.match(image, /^lumora-api:capacity-[a-z0-9_.-]{1,64}$/);
  return image;
}
export function containerOrigin(info, network, port) {
  const ip = info?.NetworkSettings?.Networks?.[network]?.IPAddress;
  assert.equal(isIP(ip ?? ""), 4, "Owned fixture has no IPv4 endpoint.");
  const bytes = ip.split(".").map(Number);
  assert.ok(bytes[0] === 10 || (bytes[0] === 172 && bytes[1] >= 16 && bytes[1] <= 31) ||
    (bytes[0] === 192 && bytes[1] === 168), "Only the owned private bridge is permitted.");
  assert.ok([5432, 11434, 3000].includes(port));
  assert.equal(Object.keys(info.HostConfig?.PortBindings ?? {}).length, 0, "The internal lab must not publish host ports.");
  return "http://" + ip + ":" + port;
}
export async function startLab(root, image, profile) {
  assertImage(image);
  assert.equal(process.platform, "linux", "The pilot requires a local Linux Docker host; fixture tests remain portable.");
  const name = "lumora-capacity-" + randomBytes(6).toString("hex"), label = "lumora.capacity.run=" + name;
  const owned = [], network = name + "-net", volume = name + "-data";
  let networkCreated = false, volumeCreated = false, cleaning;
  const cleanup = () => cleaning ??= (async () => {
    let failed = 0;
    const stopped = [];
    // Names were generated here, never supplied by a host environment variable.
    for (const container of [...owned].reverse()) {
      const present = await docker(["container", "ls", "-a", "--filter", "label=" + label, "--filter", "name=^/" + container + "$", "--format", "{{.Names}}"]).catch(() => null);
      if (present === null) { failed++; continue; }
      if (!present.trim()) continue;
      await docker(["stop", "--time=30", container]).catch(() => { failed++; });
      const state = await docker(["inspect", "--format", "{{json .State}}", container]).catch(() => null);
      if (state) {
        const { ExitCode, OOMKilled } = JSON.parse(state);
        stopped.push({ role: container.slice(name.length + 1), exitCode: ExitCode, oomKilled: OOMKilled });
      }
      await docker(["rm", "-f", container]).catch(() => { failed++; });
    }
    if (networkCreated) await docker(["network", "rm", network]).catch(() => { failed++; });
    if (volumeCreated) await docker(["volume", "rm", volume]).catch(() => { failed++; });
    return { failed, stopped };
  })();
  const run = async (role, args) => {
    const container = name + "-" + role; owned.push(container);
    await docker(["run", "-d", "--name", container, "--label", label, "--network", network, "--network-alias", role, ...args]);
    return container;
  };
  const origin = async (container, port) => containerOrigin(JSON.parse(await docker(["inspect", container]))[0], network, port);
  let setupStage = "network";
  try {
    await docker(["network", "create", "--internal", "--label", label, network]); networkCreated = true;
    setupStage = "volume"; await docker(["volume", "create", "--label", label, volume]); volumeCreated = true;
    setupStage = "postgres_container";
    const postgres = await run("postgres", ["--memory=2g", "--cpus=2", "--mount", "type=volume,src=" + volume + ",dst=/var/lib/postgresql/data",
      "-e", "POSTGRES_USER=rag", "-e", "POSTGRES_PASSWORD=capacity_fixture_only", "-e", "POSTGRES_DB=capacity_fixture", "pgvector/pgvector:pg16"]);
    setupStage = "provider_container";
    const provider = await run("provider", ["--memory=256m", "--cpus=1", "--user=node", "--read-only", "--cap-drop=ALL", "--security-opt=no-new-privileges",
      "--mount", "type=bind,src=" + resolve(root, "scripts/capacity") + ",dst=/fixture,readonly",
      "node:24-alpine", "node", "/fixture/provider.mjs"]);
    setupStage = "postgres_endpoint";
    const databaseUrl = (await origin(postgres, 5432)).replace("http:", "postgresql:").replace("//", "//rag:capacity_fixture_only@") + "/capacity_fixture";
    setupStage = "provider_endpoint";
    const providerOrigin = await origin(provider, 11434);
    const configuration = {
      DATABASE_URL: "postgresql://rag:capacity_fixture_only@postgres:5432/capacity_fixture",
      NODE_ENV: "production", HOST: "0.0.0.0", PORT: "3000",
      SUPABASE_URL: "http://provider:11434", SUPABASE_PUBLISHABLE_KEY: "capacity-fixture-public",
      OLLAMA_BASE_URL: "http://provider:11434", EMBEDDING_PROVIDER: "ollama", CHAT_PROVIDER: "ollama",
      OLLAMA_EMBEDDING_MODEL: fixtureModel, OLLAMA_CHAT_MODEL: fixtureModel, RERANKER_PROVIDER: "none",
      RAG_CLAIM_MODE: "extractive", REQUIRE_STRUCTURED_ANSWER: "true", WORKFLOWS_ENABLED: String(profile.durable),
      ...(profile.durable ? { WORKFLOW_STATE_KEY: randomBytes(32).toString("base64") } : {}),
      SEMANTIC_CACHE_TTL_SECONDS: String(profile.cacheTtlSeconds), AGENT_MAX_STEPS: "30",
      ESTIMATED_INPUT_COST_PER_1K_USD: "0", ESTIMATED_OUTPUT_COST_PER_1K_USD: "0",
      USAGE_ALERT_THRESHOLD_USD: "100000",
      INGESTION_WORKER_INTERVAL_MS: "1000", LANGSMITH_TRACING: "false", OTEL_ENABLED: "false",
      RATE_LIMIT_MAX: "10000", QA_RATE_LIMIT_MAX: "1000", RATE_LIMIT_WINDOW_MS: "1000",
      DAILY_TENANT_QA_LIMIT: "100000", DAILY_USER_QA_LIMIT: "10000", DAILY_ADMIN_UPLOAD_BYTES_LIMIT: "100000000",
      PROVIDER_TIMEOUT_MS: "10000", PDF_OCR_ENABLED: "false"
    };
    const envArgs = Object.entries(configuration).flatMap(([key, value]) => ["--env", key + "=" + value]);
    return { name, network, postgres, provider, databaseUrl, providerOrigin, cleanup,
      async migrate(authSql) {
        await docker(["exec", "-i", postgres, "psql", "-U", "rag", "-d", "capacity_fixture", "-v", "ON_ERROR_STOP=1"], authSql);
        await docker(["run", "--rm", "--network", network, "--read-only", "--cap-drop=ALL", "--security-opt=no-new-privileges",
          ...envArgs, "--entrypoint=node", image, "apps/api/dist/db/migrate.js"]);
      },
      async startApi() {
        const api = await run("api", ["--memory=512m", "--cpus=0.5", "--read-only", "--cap-drop=ALL", "--security-opt=no-new-privileges",
          "--tmpfs", "/tmp:rw,noexec,nosuid,size=32m", ...envArgs, image]);
        return { container: api, origin: await origin(api, 3000) };
      },
      async receipt() {
        const info = JSON.parse(await docker(["inspect", ...owned]));
        const net = JSON.parse(await docker(["network", "inspect", network]))[0];
        assert.equal(net.Internal, true, "The lab must not allow external provider egress.");
        return { internalNetwork: net.Internal, images: info.map(({ Config, Image, HostConfig, State }) => ({
          image: Config.Image, imageId: Image, memoryBytes: HostConfig.Memory, nanoCpus: HostConfig.NanoCpus,
          oomKilled: State.OOMKilled, running: State.Running, readOnlyRootfs: HostConfig.ReadonlyRootfs,
          publishedPorts: Object.keys(HostConfig.PortBindings ?? {}).length
        })) };
      }
    };
  } catch {
    const error = new Error("Capacity setup failed.");
    error.setupStage = setupStage; error.cleanup = await cleanup(); throw error;
  }
}
