import { AsyncLocalStorage } from "node:async_hooks";
import { Command, type BaseCheckpointSaver } from "@langchain/langgraph";

type Persistence = {
  createSaver: (graph: string) => BaseCheckpointSaver;
  runId: string;
  approved: boolean;
};
const persistence = new AsyncLocalStorage<Persistence>();
export const withGraphPersistence = <T>(
  value: Persistence,
  work: () => Promise<T>,
) => persistence.run(value, work);

export function graphExecution(name: string) {
  const current = persistence.getStore();
  if (!current) return undefined;
  const saver = current.createSaver(name);
  const config = {
    configurable: { thread_id: `${current.runId}:${name}` },
    durability: "sync" as const,
  };
  return {
    saver,
    config,
    async input<I>(
      initial: I,
      snapshot: () => Promise<{
        tasks: ReadonlyArray<{ interrupts?: ReadonlyArray<unknown> }>;
      }>,
    ): Promise<I | null | Command<unknown, never, never>> {
      if (!(await saver.getTuple(config))) return initial;
      const state = await snapshot();
      return current.approved &&
        state.tasks.some((task) => task.interrupts?.length)
        ? new Command<unknown, never, never>({ resume: { approved: true } })
        : null;
    },
  };
}
