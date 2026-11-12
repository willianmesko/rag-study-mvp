import "reflect-metadata";
import { randomUUID } from "node:crypto";
import { HttpException, type ArgumentsHost, type ExceptionFilter } from "@nestjs/common";
import type { FastifyError, FastifyReply, FastifyRequest } from "fastify";
import { NestFactory } from "@nestjs/core";
import { FastifyAdapter, type NestFastifyApplication } from "@nestjs/platform-fastify";
import { safeHttpLogSerializers } from "../../platform/http/safe-logging.js";
import type { RuntimeConfiguration } from "../configuration/environment.js";
import type { HttpDependencies } from "../http-dependencies.js";
import { buildApp, createHttpErrorHandler } from "../http-server.js";
import type { createApplication } from "../app.module.js";
import { NestApplicationModule } from "./application.module.js";
import { APPLICATION_RUNTIME, HTTP_DEPENDENCIES } from "./tokens.js";

export async function createNestHttpServer(configuration: RuntimeConfiguration, options: {
  dependencies?: HttpDependencies; isProduction?: boolean;
} = {}) {
  const adapter = new FastifyAdapter({ genReqId: () => randomUUID(),
    logger: { serializers: safeHttpLogSerializers }, bodyLimit: configuration.UPLOAD_MAX_BYTES + 100_000 });
  const nest = await NestFactory.create<NestFastifyApplication>(NestApplicationModule.register(configuration, options.dependencies), adapter,
    { logger: false, bodyParser: false, abortOnError: false });
  try {
    const dependencies = nest.get<HttpDependencies>(HTTP_DEPENDENCIES);
    const fastify = await buildApp(dependencies, { configuration, isProduction: options.isProduction,
      fastify: adapter.getInstance(), registerHealth: false });
    const handleError = createHttpErrorHandler(fastify.log);
    const filter: ExceptionFilter = { catch(error: unknown, host: ArgumentsHost) {
      const context = host.switchToHttp();
      const reply = context.getResponse<FastifyReply>();
      if (error instanceof HttpException && error.getStatus() === 404) {
        const request = context.getRequest<FastifyRequest>();
        return reply.code(404).send({ message: `Route ${request.method}:${request.url} not found`, error: "Not Found", statusCode: 404 });
      }
      const original = error instanceof HttpException && error.cause instanceof Error ? error.cause : error;
      return handleError(original as FastifyError, context.getRequest<FastifyRequest>(), reply);
    } };
    nest.useGlobalFilters(filter);
    await nest.init();
    await fastify.ready();
    return { nest, fastify, application: options.dependencies ? undefined : nest.get<ReturnType<typeof createApplication>>(APPLICATION_RUNTIME) };
  } catch (error) {
    await nest.close();
    throw error;
  }
}
