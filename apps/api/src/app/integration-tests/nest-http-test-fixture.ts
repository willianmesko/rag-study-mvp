import type { FastifyInstance } from "fastify";
import { parseRuntimeConfiguration } from "../configuration/environment.js";
import type { HttpDependencies } from "../http-dependencies.js";
import { createNestHttpServer } from "../nest/bootstrap.js";

/** Exercise the real Nest bootstrap with existing behavior fixtures and close its DI lifecycle. */
export async function buildNestTestApp(dependencies: HttpDependencies, options: {
  configuration?: ReturnType<typeof parseRuntimeConfiguration>; isProduction?: boolean;
} = {}): Promise<FastifyInstance> {
  const runtime = await createNestHttpServer(options.configuration ?? parseRuntimeConfiguration({}), { dependencies, isProduction: options.isProduction });
  return new Proxy(runtime.fastify, {
    get(target, property) {
      if (property === "close") return () => runtime.nest.close();
      const value: unknown = Reflect.get(target, property);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
}
