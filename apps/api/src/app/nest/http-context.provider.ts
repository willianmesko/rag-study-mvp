import type { FastifyInstance } from "fastify";
import { uniqueOAuthParameters } from "../../modules/mcp/mcp-oauth.controller.js";
import type { RuntimeConfiguration } from "../configuration/environment.js";
import type { HttpDependencies } from "../http-dependencies.js";
import type { HttpFeatureBindings } from "../http-feature-bindings.js";
import { buildApp } from "../http-server.js";
type RouteLimits = {
    bodyLimit?: number;
    exposeHeadRoute?: boolean;
    config?: {
        rateLimit?: {
            max: number | "question";
            timeWindow?: string;
        };
    };
};
declare module "fastify" {
    interface FastifyContextConfig {
        lumoraHttp?: RouteLimits;
        lumoraOAuth?: boolean;
    }
}
export const HTTP_FEATURE_BINDINGS = Symbol("http-feature-bindings");
/** Configure native Fastify hooks before Nest maps its decorated controllers. */
export async function configureHttpContext(app: FastifyInstance, dependencies: HttpDependencies, configuration: RuntimeConfiguration, isProduction?: boolean) {
    app.addHook("onRoute", (route) => {
        const limits = route.config?.lumoraHttp as {
            bodyLimit?: number;
            exposeHeadRoute?: boolean;
            config?: {
                rateLimit?: {
                    max: number | "question";
                };
            };
        } | undefined;
        if (!limits)
            return;
        if (limits.bodyLimit !== undefined)
            route.bodyLimit = limits.bodyLimit;
        if (limits.exposeHeadRoute !== undefined)
            route.exposeHeadRoute = limits.exposeHeadRoute;
        if (limits.config) {
            const config = structuredClone(limits.config);
            if (config.rateLimit?.max === "question")
                config.rateLimit.max = configuration.QA_RATE_LIMIT_MAX;
            Object.assign(route.config!, config);
        }
    });
    if (dependencies.remoteMcp) {
        app.addContentTypeParser("application/x-www-form-urlencoded", { parseAs: "string", bodyLimit: 8192 }, (request, body, done) => {
            if (!request.routeOptions.config.lumoraOAuth) {
                return done(Object.assign(new Error("Unsupported content type."), { code: "FST_ERR_CTP_INVALID_MEDIA_TYPE", statusCode: 415 }));
            }
            try {
                done(null, uniqueOAuthParameters(body as string));
            }
            catch (error) {
                done(error as Error);
            }
        });
    }
    let bindings: HttpFeatureBindings | undefined;
    await buildApp(dependencies, { configuration, isProduction, fastify: app, registerHealth: false,
        onBindings: (value) => { bindings = value; } });
    if (!bindings)
        throw new Error("HTTP feature bindings were not initialized.");
    return bindings;
}
