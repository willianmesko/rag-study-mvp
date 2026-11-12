import { HttpException, type ArgumentsHost, type ExceptionFilter } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { FastifyAdapter, type NestFastifyApplication } from "@nestjs/platform-fastify";
import type { FastifyError, FastifyReply, FastifyRequest } from "fastify";
import { randomUUID } from "node:crypto";
import "reflect-metadata";
import { createOAuthErrorHandler } from "../../modules/mcp/mcp-oauth.controller.js";
import { HttpAccessDenied } from "../../platform/http/nest-workspace.guard.js";
import { safeHttpLogSerializers } from "../../platform/http/safe-logging.js";
import type { createApplication } from "../app.module.js";
import type { RuntimeConfiguration } from "../configuration/environment.js";
import type { HttpDependencies } from "../http-dependencies.js";
import { createHttpErrorHandler } from "../http-server.js";
import { NestApplicationModule } from "./application.module.js";
import { APPLICATION_RUNTIME } from "./tokens.js";
export async function createNestHttpServer(configuration: RuntimeConfiguration, options: {
    dependencies?: HttpDependencies;
    isProduction?: boolean;
} = {}) {
    // Register HEAD explicitly in controllers: automatic HEAD would also expose SSE/download routes.
    const adapter = new FastifyAdapter({ exposeHeadRoutes: false, genReqId: () => randomUUID(),
        logger: { serializers: safeHttpLogSerializers }, bodyLimit: configuration.UPLOAD_MAX_BYTES + 100000 });
    const nest = await NestFactory.create<NestFastifyApplication>(NestApplicationModule.register(configuration, options.dependencies, options.isProduction), adapter, { logger: false, bodyParser: false, abortOnError: false });
    try {
        const fastify = adapter.getInstance();
        const handleError = createHttpErrorHandler(fastify.log);
        const filter: ExceptionFilter = { catch(error: unknown, host: ArgumentsHost) {
                const context = host.switchToHttp();
                const reply = context.getResponse<FastifyReply>();
                if (reply.sent)
                    return;
                if (error instanceof HttpAccessDenied)
                    return reply.code(error.getStatus()).send(error.getResponse());
                if (error instanceof HttpException && error.getStatus() === 404) {
                    const request = context.getRequest<FastifyRequest>();
                    return reply.code(404).send({ message: `Route ${request.method}:${request.url} not found`, error: "Not Found", statusCode: 404 });
                }
                const original = error instanceof HttpException && error.cause instanceof Error ? error.cause : error;
                const request = context.getRequest<FastifyRequest>();
                if (request.routeOptions.config.lumoraOAuth)
                    return createOAuthErrorHandler()(original as FastifyError, request, reply);
                return handleError(original as FastifyError, request, reply);
            } };
        nest.useGlobalFilters(filter);
        await nest.init();
        await fastify.ready();
        return { nest, fastify, application: options.dependencies ? undefined : nest.get<ReturnType<typeof createApplication>>(APPLICATION_RUNTIME) };
    }
    catch (error) {
        await nest.close();
        throw error;
    }
}
