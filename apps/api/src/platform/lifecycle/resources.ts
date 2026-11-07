type ApplicationResources = {
  workflows?: { close(): Promise<void> };
  pool: { end(): Promise<void> };
  mcpReadPool?: { end(): Promise<void> } | null;
};

/** Stop workflow work first, then attempt every owned pool even after failures. */
export async function closeApplicationResources(resources: ApplicationResources): Promise<void> {
  const failures: unknown[] = [];
  try {
    await resources.workflows?.close();
  } catch (error) {
    failures.push(error);
  } finally {
    const results = await Promise.allSettled([
      Promise.resolve().then(() => resources.pool.end()),
      Promise.resolve().then(() => resources.mcpReadPool?.end()),
    ]);
    for (const result of results) if (result.status === "rejected") failures.push(result.reason);
  }
  if (failures.length) throw new AggregateError(failures, "Application resources could not close.");
}
