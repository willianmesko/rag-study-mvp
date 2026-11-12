import { NestFactory } from "@nestjs/core";
import { FastifyAdapter, type NestFastifyApplication } from "@nestjs/platform-fastify";
import Fastify, { type FastifyInstance, type RouteOptions } from "fastify";
import assert from "node:assert/strict";
import test from "node:test";
import { McpOAuth } from "../../modules/mcp/application/oauth.js";
import type { McpOAuthRepository } from "../../modules/mcp/application/remote-types.js";
import { parseRuntimeConfiguration } from "../configuration/environment.js";
import type { HttpDependencies } from "../http-dependencies.js";
import { buildApp } from "../http-server.js";
import { NestApplicationModule } from "../nest/application.module.js";
function inventory(app: FastifyInstance) {
    const routes: RouteOptions[] = [];
    app.addHook("onRoute", (route) => { routes.push(route); });
    return () => routes.flatMap((route) => [route.method].flat().map((method) => ({
        method, url: route.url,
        bodyLimit: route.bodyLimit ?? app.initialConfig.bodyLimit,
        rateLimit: route.config?.rateLimit ?? null,
    }))).sort((a, b) => `${a.url} ${a.method}`.localeCompare(`${b.url} ${b.method}`));
}
for (const optional of [false, true]) {
    test(`native Nest routes preserve methods, paths, body limits and rate limits (optional features: ${optional})`, async (t) => {
        const configuration = parseRuntimeConfiguration({ QA_RATE_LIMIT_MAX: "7" });
        const dependencies = (optional ? {
            conversations: { pruneExpired: async () => { }, pending: async () => [] },
            workspaceMcp: {}, agentActions: {},
            remoteMcp: { oauth: new McpOAuth({} as McpOAuthRepository, "https://api.example/mcp", "https://app.example"), tools: {}, controls: {} },
        } : {}) as HttpDependencies;
        const previous = Fastify({ logger: false, bodyLimit: configuration.UPLOAD_MAX_BYTES + 100000 });
        const current = Fastify({ exposeHeadRoutes: false, logger: false, bodyLimit: configuration.UPLOAD_MAX_BYTES + 100000 });
        const expected = inventory(previous), actual = inventory(current);
        t.after(() => previous.close());
        const nest = await NestFactory.create<NestFastifyApplication>(NestApplicationModule.register(configuration, dependencies), new FastifyAdapter(current), { logger: false, bodyParser: false, abortOnError: false });
        t.after(() => nest.close());
        await buildApp(dependencies, { configuration, fastify: previous });
        await previous.ready();
        await nest.init();
        await current.ready();
        assert.ok(expected().length > 40, "the comparison includes the complete route surface, including HEAD");
        assert.deepEqual(actual(), expected());
    });
}
