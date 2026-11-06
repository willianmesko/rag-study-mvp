import type { IngestionJobRepository } from "../ports/ingestion-job-repository.js";

export class RetryIngestionJobUseCase {
  constructor(private readonly jobs: IngestionJobRepository) {}

  async execute(id: string): Promise<void> {
    const retried = await this.jobs.retry(id);
    if (!retried) throw new Error("Only failed ingestion jobs can be retried.");
  }
}
