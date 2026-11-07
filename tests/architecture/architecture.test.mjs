import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import test from "node:test";
import { checkArchitecture } from "../../scripts/check-architecture.mjs";
import { computedImports, productionFiles } from "../../scripts/architecture-source.mjs";

const web = "apps/web/src/";
const api = "apps/api/src/";
const contracts = "packages/contracts/src/";
const base = {
  [`${web}app/index.ts`]: 'import { feature } from "../features/alpha"; export const app = feature;',
  [`${web}app/config.ts`]: 'export const config = true; export type Config = { enabled: boolean };',
  [`${web}features/alpha/index.ts`]: 'export { feature } from "./ui/Feature";',
  [`${web}features/alpha/ui/Feature.ts`]: 'import { state } from "../model/state"; import { entity } from "../../../entities/document"; export const feature = state + entity;',
  [`${web}features/alpha/model/state.ts`]: 'export const state = 1;',
  [`${web}entities/document/index.ts`]: 'export { entity } from "./model/document"; export type { Document } from "./model/document";',
  [`${web}entities/document/model/document.ts`]: 'export const entity = 2; export type Document = { title: string };',
  [`${web}shared/lib/format.ts`]: 'export const format = (value: number) => String(value);',
  [`${web}shared/api/client.ts`]: 'export const client = { ready: true };',
};

async function fixture(t, changes = {}) {
  const root = await mkdtemp(path.join(os.tmpdir(), "lumora-architecture-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const files = { ...base, ...changes,
    "apps/web/tsconfig.json": JSON.stringify({ compilerOptions: {
      target: "ES2022", module: "ESNext", moduleResolution: "Bundler", strict: true, noEmit: true,
    } }),
  };
  for (const [name, contents] of Object.entries(files)) {
    const filename = path.join(root, name);
    await mkdir(path.dirname(filename), { recursive: true });
    await writeFile(filename, contents);
  }
  return root;
}

const cases = [
  { name: "legal same-slice and lower-layer Public API", changes: {} },
  { name: "legal type-only public import", changes: {
    [`${web}features/alpha/ui/Feature.ts`]: 'import type { Document } from "../../../entities/document"; export const feature: Document = { title: "Guide" };',
  } },
  { name: "legal Shared leaf modules", changes: {
    [`${web}features/alpha/ui/Feature.ts`]: 'import { format } from "../../../shared/lib/format"; import { client } from "../../../shared/api/client"; export const feature = format(Number(client.ready));',
  } },
  { name: "legal literal dynamic Public API", changes: {
    [`${web}app/index.ts`]: 'export const feature = () => import("../features/alpha");',
  } },
  { name: "legal conditional ESM package subpath", changes: {
    [`${web}features/alpha/ui/Feature.ts`]: 'import { transport } from "fixture-adapter/transport"; export const feature = transport;',
    "node_modules/fixture-adapter/package.json": JSON.stringify({ name: "fixture-adapter", type: "module",
      exports: { "./transport": { import: { types: "./dist/transport.d.ts", default: "./dist/transport.js" } } } }),
    "node_modules/fixture-adapter/dist/transport.js": 'export const transport = true;',
    "node_modules/fixture-adapter/dist/transport.d.ts": 'export declare const transport: boolean;',
  } },
  { name: "legal type-only package subpath", changes: {
    [`${web}env.d.ts`]: '/// <reference types="fixture-env/client" />',
    "node_modules/fixture-env/package.json": JSON.stringify({ name: "fixture-env",
      exports: { "./client": { types: "./client.d.ts" } } }),
    "node_modules/fixture-env/client.d.ts": 'export interface Environment { ready: boolean }',
  } },
  { name: "upward import", rule: "web-no-upward-from-features", changes: {
    [`${web}features/alpha/ui/Feature.ts`]: 'import { config } from "../../../app/config"; export const feature = config;',
  } },
  { name: "type-only upward import", rule: "web-no-upward-from-features", changes: {
    [`${web}features/alpha/ui/Feature.ts`]: 'import type { Config } from "../../../app/config"; export const feature: Config = { enabled: true };',
  } },
  { name: "private implementation import", rule: "web-no-private-cross-slice", changes: {
    [`${web}features/alpha/ui/Feature.ts`]: 'import { entity } from "../../../entities/document/model/document"; export const feature = entity;',
  } },
  { name: "cross-slice import", rule: "web-no-cross-slice", changes: {
    [`${web}features/beta/index.ts`]: 'export { other } from "./ui/Other";',
    [`${web}features/beta/ui/Other.ts`]: 'import { feature } from "../../alpha"; export const other = feature;',
  } },
  { name: "private literal dynamic import", rule: "web-no-private-from-unsliced", changes: {
    [`${web}app/index.ts`]: 'export const feature = () => import("../features/alpha/ui/Feature");',
  } },
  { name: "private literal-template dynamic import", rule: "web-no-private-from-unsliced", changes: {
    [`${web}app/index.ts`]: 'export const feature = () => import(`../features/alpha/ui/Feature`);',
  } },
  { name: "parenthesized dynamic target cannot hide a private import", rule: "computed-dynamic-import", changes: {
    [`${web}app/index.ts`]: 'export const feature = () => import(("../features/alpha/ui/Feature"));',
  } },
  { name: "dynamic cross-slice import", rule: "web-no-cross-slice", changes: {
    [`${web}features/beta/index.ts`]: 'export { other } from "./ui/Other";',
    [`${web}features/beta/ui/Other.ts`]: 'export const other = () => import("../../alpha");',
  } },
  { name: "private reexport", rule: "web-no-private-from-unsliced", changes: {
    [`${web}app/index.ts`]: 'export { feature } from "../features/alpha/ui/Feature";',
  } },
  { name: "bootstrap cannot bypass a slice Public API", rule: "web-no-private-from-unsliced", changes: {
    [`${web}main.ts`]: 'import { feature } from "./features/alpha/ui/Feature"; export const app = feature;',
  } },
  { name: "runtime cycle", rule: "no-runtime-cycles", changes: {
    [`${web}shared/lib/a.ts`]: 'import { b } from "./b"; export const a = b;',
    [`${web}shared/lib/b.ts`]: 'import { a } from "./a"; export const b = a;',
  } },
  { name: "legal type-only graph cycle", changes: {
    [`${web}shared/lib/a.ts`]: 'import type { B } from "./b"; export type A = { value?: B };',
    [`${web}shared/lib/b.ts`]: 'import type { A } from "./a"; export type B = { value?: A };',
  } },
  { name: "legal mixed graph cycle with no runtime cycle", changes: {
    [`${web}shared/lib/a.ts`]: 'import { b } from "./b"; export type A = { value: boolean }; export const a = b;',
    [`${web}shared/lib/b.ts`]: 'import type { A } from "./a"; export const b: A = { value: true };',
  } },
  { name: "runtime cycle remains visible beside a type-only shortcut", rule: "no-runtime-cycles", changes: {
    [`${web}shared/lib/a.ts`]: 'import type { B } from "./b"; import { c } from "./c"; export type A = { value?: B }; export const a = c;',
    [`${web}shared/lib/b.ts`]: 'import { a } from "./a"; export type B = { label: string }; export const b = a;',
    [`${web}shared/lib/c.ts`]: 'import { b } from "./b"; export const c = b;',
  } },
  { name: "computed dynamic import", rule: "computed-dynamic-import", changes: {
    [`${web}app/index.ts`]: 'const target = "../features/alpha/ui/Feature"; export const feature = () => import(target);',
  } },
  { name: "legal backend adapter imports a port", changes: {
    [`${api}application/ports/store.ts`]: 'export interface Store { read(): number }',
    [`${api}infrastructure/store.ts`]: 'import type { Store } from "../application/ports/store.js"; export const store: Store = { read: () => 1 };',
  } },
  { name: "backend application imports an adapter", rule: "api-inner-layers-independent", changes: {
    [`${api}application/service.ts`]: 'import { adapter } from "../infrastructure/adapter.js"; export const service = adapter;',
    [`${api}infrastructure/adapter.ts`]: 'export const adapter = true;',
  } },
  { name: "backend domain imports an HTTP type", rule: "api-inner-layers-independent", changes: {
    [`${api}domain/entity.ts`]: 'import type { Request } from "../interfaces/http.js"; export type Entity = Request;',
    [`${api}interfaces/http.ts`]: 'export type Request = { user: string };',
  } },
  { name: "production imports a test implementation", rule: "production-does-not-import-tests", changes: {
    [`${web}features/alpha/ui/Feature.ts`]: 'import { spy } from "../model/spy.test"; export const feature = spy;',
    [`${web}features/alpha/model/spy.test.ts`]: 'export const spy = 1;',
  } },
];

const moduleFiles = {
  [`${api}modules/knowledge/domain/document.ts`]: 'export type Document = { title: string };',
  [`${api}modules/knowledge/application/ports/store.ts`]: 'export interface Store { read(): number }',
  [`${api}modules/knowledge/application/use-cases/read.ts`]: 'import type { Store } from "../ports/store.js"; export const read = (store: Store) => store.read();',
  [`${api}modules/knowledge/infrastructure/store.ts`]: 'import type { Store } from "../application/ports/store.js"; export const store: Store = { read: () => 1 };',
  [`${api}modules/knowledge/knowledge.module.ts`]: 'import { read } from "./application/use-cases/read.js"; import type { Store } from "./application/ports/store.js"; export const service = (store: Store) => read(store); export type Service = typeof service;',
  [`${api}modules/knowledge/documents.controller.ts`]: 'import { service } from "./knowledge.module.js"; export const route = service; export type Request = { workspaceId: string };',
  [`${api}modules/knowledge/http/serialize.ts`]: 'export const serialize = (value: number) => ({ value });',
  [`${api}modules/knowledge/index.ts`]: 'export type { Document } from "./domain/document.js"; export { read } from "./application/use-cases/read.js";',
  [`${api}modules/identity/domain/identity.ts`]: 'export type Identity = { userId: string }; export const authenticated = true;',
  [`${api}modules/identity/index.ts`]: 'export { authenticated } from "./domain/identity.js"; export type { Identity } from "./domain/identity.js";',
  [`${api}modules/workspaces/domain/membership.ts`]: 'export type Membership = { workspaceId: string };',
  [`${api}modules/workspaces/index.ts`]: 'export type { Membership } from "./domain/membership.js";',
  [`${api}modules/chat/application/search.ts`]: 'import { read } from "../../knowledge/index.js"; import type { Document } from "../../knowledge/index.js"; export const search: Document = { title: String(read({ read: () => 1 })) };',
  [`${api}modules/chat/index.ts`]: 'export { search } from "./application/search.js";',
};

const moduleCases = [
  { name: "legal business-module internals and cross-module Public APIs", changes: {} },
  { name: "legal app and CLI composition access private implementations", changes: {
    [`${api}app/app.module.ts`]: 'import { service } from "../modules/knowledge/knowledge.module.js"; export const application = service;',
    [`${api}app/http-server.ts`]: 'import { route } from "../modules/knowledge/documents.controller.js"; export const routes = [route];',
    [`${api}app/cli/inspect.ts`]: 'import { store } from "../../modules/knowledge/infrastructure/store.js"; export const inspect = store.read;',
  } },
  { name: "legal exact platform authorization type adapters", changes: {
    [`${api}platform/http/workspace-authorization.ts`]: 'import type { Identity } from "../../modules/identity/index.js"; import type { Membership } from "../../modules/workspaces/index.js"; export type Principal = Identity & Membership;',
  } },
  { name: "module application imports its own adapter", rule: "api-module-inner-layers-independent", changes: {
    [`${api}modules/knowledge/application/service.ts`]: 'import { store } from "../infrastructure/store.js"; export const service = store;',
  } },
  { name: "module domain imports a controller type", rule: "api-module-inner-layers-independent", changes: {
    [`${api}modules/knowledge/domain/entity.ts`]: 'import type { Request } from "../documents.controller.js"; export type Entity = Request;',
  } },
  { name: "module application imports HTTP serialization", rule: "api-module-inner-layers-independent", changes: {
    [`${api}modules/knowledge/application/service.ts`]: 'import { serialize } from "../http/serialize.js"; export const service = serialize;',
  } },
  { name: "module application imports its own composition factory", rule: "api-module-inner-layers-independent", changes: {
    [`${api}modules/knowledge/application/service.ts`]: 'import { service } from "../knowledge.module.js"; export const nestedService = service;',
  } },
  { name: "module domain imports app composition types", rule: "api-module-inner-layers-independent", changes: {
    [`${api}modules/knowledge/domain/entity.ts`]: 'import type { App } from "../../../app/types.js"; export type Entity = App;',
    [`${api}app/types.ts`]: 'export type App = { version: string };',
  } },
  { name: "module application imports legacy adapters during transition", rule: "api-module-inner-layers-independent", changes: {
    [`${api}modules/knowledge/application/service.ts`]: 'import { adapter } from "../../../infrastructure/adapter.js"; export const service = adapter;',
    [`${api}infrastructure/adapter.ts`]: 'export const adapter = true;',
  } },
  { name: "cross-module type imports cannot bypass Public APIs", rule: "api-no-private-cross-module", changes: {
    [`${api}modules/chat/application/search.ts`]: 'import type { Document } from "../../knowledge/domain/document.js"; export const search: Document = { title: "Guide" };',
  } },
  { name: "cross-module literal dynamic imports cannot bypass Public APIs", rule: "api-no-private-cross-module", changes: {
    [`${api}modules/chat/chat.module.ts`]: 'export const lazyStore = () => import("../knowledge/infrastructure/store.js");',
  } },
  { name: "module factories have no cross-module private privilege", rule: "api-no-private-cross-module", changes: {
    [`${api}modules/chat/chat.module.ts`]: 'import { service } from "../knowledge/knowledge.module.js"; export const chat = service;',
  } },
  { name: "module Public API cannot export controllers", rule: "api-module-public-api-no-composition", changes: {
    [`${api}modules/knowledge/index.ts`]: 'export type { Document } from "./domain/document.js"; export { read } from "./application/use-cases/read.js"; export { route } from "./documents.controller.js";',
  } },
  { name: "module Public API cannot export factory types", rule: "api-module-public-api-no-composition", changes: {
    [`${api}modules/knowledge/index.ts`]: 'export type { Document } from "./domain/document.js"; export { read } from "./application/use-cases/read.js"; export type { Service } from "./knowledge.module.js";',
  } },
  { name: "generic platform cannot consume module types", rule: "api-platform-no-module-import", changes: {
    [`${api}platform/http/identity.ts`]: 'import type { Identity } from "../../modules/identity/index.js"; export type User = Identity;',
  } },
  { name: "nearby platform source cannot reuse authorization type exception", rule: "api-platform-no-module-import", changes: {
    [`${api}platform/http/workspace-authorization-extra.ts`]: 'import type { Identity } from "../../modules/identity/index.js"; export type User = Identity;',
  } },
  { name: "platform authorization exception cannot access another feature", rule: "api-platform-authorization-public-types-only", changes: {
    [`${api}platform/http/workspace-authorization.ts`]: 'import type { Document } from "../../modules/knowledge/index.js"; export type Source = Document;',
  } },
  { name: "platform authorization exception cannot access private module types", rule: "api-platform-authorization-public-types-only", changes: {
    [`${api}platform/http/workspace-authorization.ts`]: 'import type { Identity } from "../../modules/identity/domain/identity.js"; export type User = Identity;',
  } },
  { name: "platform authorization cannot use excepted module at runtime", rule: "api-platform-no-module-runtime", changes: {
    [`${api}platform/http/workspace-authorization.ts`]: 'import { authenticated } from "../../modules/identity/index.js"; export const authorized = authenticated;',
  } },
  { name: "mixed type and runtime module edge cannot hide platform violation", rule: "api-platform-no-module-runtime", changes: {
    [`${api}platform/http/workspace-authorization.ts`]: 'import type { Identity } from "../../modules/identity/index.js"; import { authenticated } from "../../modules/identity/index.js"; export const authorized: Identity | null = authenticated ? { userId: "user" } : null;',
  } },
  { name: "platform cannot depend on app composition even through types", rule: "api-platform-independent-of-composition", changes: {
    [`${api}platform/http/client.ts`]: 'import type { App } from "../../app/types.js"; export type Client = App;',
    [`${api}app/types.ts`]: 'export type App = { version: string };',
  } },
  { name: "runtime cycles through module Public APIs still fail", rule: "no-runtime-cycles", changes: {
    [`${api}modules/identity/index.ts`]: 'import { workspace } from "../workspaces/index.js"; export const identity = workspace;',
    [`${api}modules/workspaces/index.ts`]: 'import { identity } from "../identity/index.js"; export const workspace = identity;',
  } },
  { name: "type-only cycles through module Public APIs remain legal", changes: {
    [`${api}modules/identity/index.ts`]: 'import type { Membership } from "../workspaces/index.js"; export type Identity = { membership?: Membership };',
    [`${api}modules/workspaces/index.ts`]: 'import type { Identity } from "../identity/index.js"; export type Membership = { identity?: Identity };',
  } },
].map((entry) => ({ ...entry, changes: { ...moduleFiles, ...entry.changes } }));

const applicationCases = [
  { name: "both applications consume shared runtime and type contracts", changes: {
    [`${contracts}index.ts`]: 'export const version = 1; export type Contract = { version: number };',
    [`${web}app/contracts.ts`]: 'import { version } from "../../../../packages/contracts/src/index.js"; import type { Contract } from "../../../../packages/contracts/src/index.js"; export const client: Contract = { version };',
    [`${api}app/contracts.ts`]: 'import { version } from "../../../../packages/contracts/src/index.js"; import type { Contract } from "../../../../packages/contracts/src/index.js"; export const server: Contract = { version };',
  } },
  { name: "frontend cannot import backend runtime code", rule: "web-no-api-import", changes: {
    [`${web}app/backend.ts`]: 'import { backend } from "../../../api/src/app/backend.js"; export const application = backend;',
    [`${api}app/backend.ts`]: 'export const backend = true;',
  } },
  { name: "frontend cannot import backend Public API types", rule: "web-no-api-import", changes: {
    [`${web}app/backend.ts`]: 'import type { Record } from "../../../api/src/modules/knowledge/index.js"; export type Application = Record;',
    [`${api}modules/knowledge/index.ts`]: 'export type Record = { id: string };',
  } },
  { name: "frontend cannot bypass backend boundary through generated code", rule: "web-no-api-import", changes: {
    [`${web}app/backend.ts`]: 'import { backend } from "../../../api/dist/backend.js"; export const application = backend;',
    "apps/api/dist/backend.js": 'export const backend = true;',
  } },
  { name: "backend cannot import frontend runtime Public APIs", rule: "api-no-web-import", changes: {
    [`${api}app/frontend.ts`]: 'import { feature } from "../../../web/src/features/alpha/index.js"; export const application = feature;',
  } },
  { name: "backend cannot import frontend Public API types", rule: "api-no-web-import", changes: {
    [`${api}app/frontend.ts`]: 'import type { Document } from "../../../web/src/entities/document/index.js"; export type Record = Document;',
  } },
  { name: "backend cannot bypass frontend boundary through generated code", rule: "api-no-web-import", changes: {
    [`${api}app/frontend.ts`]: 'import { frontend } from "../../../web/dist/frontend.js"; export const application = frontend;',
    "apps/web/dist/frontend.js": 'export const frontend = true;',
  } },
  { name: "shared contracts cannot import backend runtime code", rule: "contracts-no-application-import", changes: {
    [`${contracts}index.ts`]: 'import { backend } from "../../../apps/api/src/app/backend.js"; export const version = backend;',
    [`${api}app/backend.ts`]: 'export const backend = true;',
  } },
  { name: "shared contracts cannot reexport frontend types", rule: "contracts-no-application-import", changes: {
    [`${contracts}index.ts`]: 'export type { Document } from "../../../apps/web/src/entities/document/index.js";',
  } },
  { name: "shared contracts cannot depend on a future application", rule: "contracts-no-application-import", changes: {
    [`${contracts}index.ts`]: 'import type { Job } from "../../../apps/worker/src/job.js"; export type Work = Job;',
    "apps/worker/src/job.ts": 'export type Job = { id: string };',
  } },
].map((entry) => ({ ...entry, name: `cross-application: ${entry.name}` }));

function sdkFixture(name) {
  return {
    [`node_modules/${name}/package.json`]: JSON.stringify({ name, type: "module", exports: { ".": { types: "./index.d.ts", import: "./index.js" } } }),
    [`node_modules/${name}/index.js`]: 'export const client = true;',
    [`node_modules/${name}/index.d.ts`]: 'export declare const client: boolean; export interface Client { ready: boolean }',
  };
}

const technologyCases = [
  ...[
    { name: "application cannot import an AWS SDK value", sdk: "@aws-sdk/client-bedrock-runtime", source: "application/use-cases/vendor.ts", type: false },
    { name: "domain cannot import PostgreSQL driver types", sdk: "pg", source: "domain/vendor.ts", type: true },
    { name: "module factory cannot import Supabase SDK types", sdk: "@supabase/supabase-js", source: "knowledge.module.ts", type: true },
    { name: "module factory cannot import LangGraph", sdk: "@langchain/langgraph", source: "knowledge.module.ts", type: false },
    { name: "application cannot import LangSmith SDK types", sdk: "langsmith", source: "application/use-cases/vendor.ts", type: true },
    { name: "application cannot import Fastify transport types", sdk: "fastify", source: "application/use-cases/vendor.ts", type: true },
  ].map(({ name, sdk, source, type }) => ({ name, rule: "api-core-no-vendor-sdk", changes: {
    ...sdkFixture(sdk),
    [`${api}modules/knowledge/${source}`]: type
      ? `import type { Client } from "${sdk}"; export type Vendor = Client;`
      : `import { client } from "${sdk}"; export const vendor = client;`,
  } })),
  { name: "module factory cannot construct its concrete adapter", rule: "api-core-no-concrete-infrastructure", changes: {
    [`${api}modules/knowledge/knowledge.module.ts`]: 'import { store } from "./infrastructure/store.js"; export const service = () => store.read();',
  } },
  { name: "module factory cannot use concrete adapter types", rule: "api-core-no-concrete-infrastructure", changes: {
    [`${api}modules/knowledge/knowledge.module.ts`]: 'import type { ConcreteStore } from "./infrastructure/concrete.ts"; export type Service = ConcreteStore;',
    [`${api}modules/knowledge/infrastructure/concrete.ts`]: 'export type ConcreteStore = { read(): number };',
  } },
  { name: "module factory cannot bypass injection through app composition", rule: "api-core-no-concrete-infrastructure", changes: {
    [`${api}modules/knowledge/knowledge.module.ts`]: 'import { adapter } from "../../app/composition/adapter.js"; export const service = adapter;',
    [`${api}app/composition/adapter.ts`]: 'export const adapter = true;',
  } },
  { name: "public APIs cannot disguise concrete adapters as types", rule: "api-module-public-api-no-infrastructure", changes: {
    [`${api}modules/knowledge/index.ts`]: 'export type { ConcreteStore } from "./infrastructure/concrete.js";',
    [`${api}modules/knowledge/infrastructure/concrete.ts`]: 'export type ConcreteStore = { read(): number };',
  } },
  { name: "public APIs cannot export concrete adapter values", rule: "api-module-public-api-no-infrastructure", changes: {
    [`${api}modules/knowledge/index.ts`]: 'export { store } from "./infrastructure/store.js";',
  } },
  { name: "module factories cannot import a concrete Bedrock client", rule: "api-core-no-technical-adapter", changes: {
    [`${api}modules/knowledge/knowledge.module.ts`]: 'import { client } from "../../platform/ai/bedrock-client.js"; export const service = client;',
    [`${api}platform/ai/bedrock-client.ts`]: 'export const client = true;',
  } },
  { name: "core ports cannot import concrete database pool types", rule: "api-core-no-technical-adapter", changes: {
    [`${api}modules/knowledge/application/ports/database.ts`]: 'import type { Pool } from "../../../../platform/database/pool.js"; export type Database = Pool;',
    [`${api}platform/database/pool.ts`]: 'export type Pool = { query(): number };',
  } },
  { name: "core ports cannot import a concrete graph executor type", rule: "api-core-no-technical-adapter", changes: {
    [`${api}modules/knowledge/application/ports/graph.ts`]: 'import type { Graph } from "../../../../platform/workflows/graph-execution.js"; export type Workflow = Graph;',
    [`${api}platform/workflows/graph-execution.ts`]: 'export type Graph = { execute(): number };',
  } },
  { name: "module factories receive options instead of global environment types", rule: "api-core-no-environment-import", changes: {
    [`${api}modules/knowledge/knowledge.module.ts`]: 'import type { config } from "../../config.js"; export type Options = typeof config;',
    [`${api}config.ts`]: 'export const config = { DATABASE_URL: "fixture" };',
  } },
  { name: "concrete SDKs remain legal in adapters and outer composition", changes: {
    ...sdkFixture("@aws-sdk/client-bedrock-runtime"),
    [`${api}modules/knowledge/infrastructure/store.ts`]: 'import { client } from "@aws-sdk/client-bedrock-runtime"; export const store = { read: () => Number(client) };',
    [`${api}app/composition/adapter.ts`]: 'import { client } from "@aws-sdk/client-bedrock-runtime"; import { store } from "../../modules/knowledge/infrastructure/store.js"; export const adapter = { client, store };',
  } },
  { name: "neutral errors and workflow contracts remain legal core dependencies", changes: {
    [`${api}modules/knowledge/application/ports/workflow.ts`]: 'import type { Workflow } from "../../../../platform/workflows/types.js"; import { EmbeddingIndexChangedError } from "../../../../platform/database/embedding-index-error.js"; export type State = Workflow; export const conflict = EmbeddingIndexChangedError;',
    [`${api}platform/workflows/types.ts`]: 'export type Workflow = { runId: string };',
    [`${api}platform/database/embedding-index-error.ts`]: 'export class EmbeddingIndexChangedError extends Error {}',
  } },
].map((entry) => ({ ...entry, name: `technology boundary: ${entry.name}`, changes: { ...moduleFiles, ...entry.changes } }));

for (const entry of [...cases, ...moduleCases, ...applicationCases, ...technologyCases]) test(`architecture gate: ${entry.name}`, async (t) => {
  const root = await fixture(t, entry.changes);
  let output = "";
  const code = await checkArchitecture({ root, write: (value) => { output += value; } });
  assert.equal(code, entry.rule ? 1 : 0, output);
  if (entry.rule) assert.ok(output.includes(entry.rule), output);
});

test("computed import guard uses syntax rather than searching source text", () => {
  const legal = 'const note = "import(target)"; type T = import("./types").T; import("./module"); import(`./module`);';
  assert.deepEqual(computedImports(legal, "source.ts"), []);
  const findings = computedImports('import(target);\nimport("./" + target);\nimport(`./${target}`);\nimport(("./module"));', "source.ts");
  assert.deepEqual(findings.map(({ line }) => line), [1, 2, 3, 4]);
  assert.ok(findings.every(({ file }) => file === "source.ts"));
});

test("test files are not entry points but imports of them remain enforceable", async (t) => {
  const root = await fixture(t, { [`${web}app/ignored.test.ts`]: 'import("../" + "computed");' });
  const files = await productionFiles(root);
  assert.ok(files.includes(`${web}app/index.ts`));
  assert.ok(files.every((file) => !file.endsWith(".test.ts")));
});

test("missing checker fails instead of silently skipping the gate", async (t) => {
  const root = await fixture(t);
  let output = "";
  assert.equal(await checkArchitecture({ root, cruiser: path.join(root, "missing.mjs"), write: (value) => { output += value; } }), 1);
  assert.match(output, /checker is unavailable/);
});
