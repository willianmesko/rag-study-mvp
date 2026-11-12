import { Controller, Get, Inject } from "@nestjs/common";
import type { HttpDependencies } from "../http-dependencies.js";
import type { RuntimeConfiguration } from "../configuration/environment.js";
import { HTTP_DEPENDENCIES, RUNTIME_CONFIGURATION } from "./tokens.js";

@Controller()
export class HealthController {
  constructor(
    @Inject(RUNTIME_CONFIGURATION) private readonly config: RuntimeConfiguration,
    @Inject(HTTP_DEPENDENCIES) private readonly dependencies: HttpDependencies,
  ) {}

  @Get("health")
  health() {
    return { status: "ok", capabilities: { pdfOcr: this.config.PDF_OCR_ENABLED,
      durableWorkflows: Boolean(this.dependencies.workflows), durableConversations: Boolean(this.dependencies.conversations) } };
  }
}
