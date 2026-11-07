import {
  BaseCheckpointSaver,
  type CheckpointTuple,
} from "@langchain/langgraph";
import {
  WorkflowGuardError,
  type WorkflowLease,
} from "../../application/workflows/types.js";
import {
  PgWorkflowRepository,
  workflowParams,
} from "../postgres/pg-workflow-repository.js";

type Config = Parameters<BaseCheckpointSaver["getTuple"]>[0];
type Stored = {
  checkpoint_id: string;
  parent_id: string | null;
  encoding: string;
  cipher: Buffer;
};
// Framework special-write slots, covered by the interrupt/restart integration tests.
const slots: Record<string, number> = {
  __error__: -1,
  __scheduled__: -2,
  __interrupt__: -3,
  __resume__: -4,
};

export class PgWorkflowCheckpointer extends BaseCheckpointSaver {
  readonly threadId: string;
  constructor(
    private readonly repository: PgWorkflowRepository,
    private readonly lease: WorkflowLease,
    private readonly graph: string,
  ) {
    super();
    this.threadId = `${lease.runId}:${graph}`;
  }
  private params() {
    return [...workflowParams(this.lease), this.graph];
  }
  private scope(config: Config) {
    const namespace = config.configurable?.checkpoint_ns ?? "";
    if (
      config.configurable?.thread_id !== this.threadId ||
      typeof namespace !== "string" ||
      namespace.length > 1_000
    )
      throw new WorkflowGuardError("authorization_revoked");
    return namespace;
  }
  private identity(namespace: string, id: string, ...extra: string[]) {
    return [...this.params(), namespace, id, ...extra];
  }
  private config(namespace: string, id: string): Config {
    return {
      configurable: {
        thread_id: this.threadId,
        checkpoint_ns: namespace,
        checkpoint_id: id,
      },
    };
  }

  async getTuple(config: Config): Promise<CheckpointTuple | undefined> {
    const namespace = this.scope(config),
      id = config.configurable?.checkpoint_id as string | undefined;
    return this.repository.fenced(this.lease, async (client) => {
      const {
        rows: [row],
      } = await client.query<Stored>(
        `SELECT checkpoint_id,parent_id,encoding,cipher FROM workflow_checkpoints
        WHERE tenant_id=$1 AND actor_id=$2 AND run_id=$3 AND graph_name=$4 AND namespace=$5
        AND ($6::text IS NULL OR checkpoint_id=$6) ORDER BY checkpoint_id DESC LIMIT 1`,
        [...this.params(), namespace, id ?? null],
      );
      if (!row) return undefined;
      const saved = await this.serde.loadsTyped(
        row.encoding,
        this.repository.codec.decode(
          row.cipher,
          this.identity(namespace, row.checkpoint_id),
        ),
      );
      const { rows: writes } = await client.query<{
        task_id: string;
        ordinal: number;
        encoding: string;
        cipher: Buffer;
      }>(
        `SELECT task_id,ordinal,encoding,cipher FROM workflow_writes
        WHERE tenant_id=$1 AND actor_id=$2 AND run_id=$3 AND graph_name=$4 AND namespace=$5 AND checkpoint_id=$6
        ORDER BY task_path COLLATE "C",task_id COLLATE "C",ordinal`,
        [...this.params(), namespace, row.checkpoint_id],
      );
      const pendingWrites: NonNullable<CheckpointTuple["pendingWrites"]> =
        await Promise.all(
          writes.map(async (w) => {
            const [channel, value] = await this.serde.loadsTyped(
              w.encoding,
              this.repository.codec.decode(
                w.cipher,
                this.identity(
                  namespace,
                  row.checkpoint_id,
                  w.task_id,
                  String(w.ordinal),
                ),
              ),
            );
            return [w.task_id, channel, value];
          }),
        );
      return {
        config: this.config(namespace, row.checkpoint_id),
        checkpoint: saved.checkpoint,
        metadata: saved.metadata,
        pendingWrites,
        ...(row.parent_id
          ? { parentConfig: this.config(namespace, row.parent_id) }
          : {}),
      };
    });
  }

  async *list(
    config: Config,
    options?: Parameters<BaseCheckpointSaver["list"]>[1],
  ): AsyncGenerator<CheckpointTuple> {
    const namespace = this.scope(config);
    const { rows } = await this.repository.pool.query<{
      checkpoint_id: string;
    }>(
      `SELECT checkpoint_id FROM workflow_checkpoints
      WHERE tenant_id=$1 AND actor_id=$2 AND run_id=$3 AND graph_name=$4 AND namespace=$5
      AND ($6::text IS NULL OR checkpoint_id<$6) ORDER BY checkpoint_id DESC LIMIT $7`,
      [
        ...this.params(),
        namespace,
        options?.before?.configurable?.checkpoint_id ?? null,
        Math.min(options?.limit ?? 10, 50),
      ],
    );
    for (const row of rows) {
      const tuple = await this.getTuple(
        this.config(namespace, row.checkpoint_id),
      );
      if (tuple) yield tuple;
    }
  }

  async put(
    ...[config, checkpoint, metadata]: Parameters<BaseCheckpointSaver["put"]>
  ): Promise<Config> {
    const namespace = this.scope(config);
    const [encoding, bytes] = await this.serde.dumpsTyped({
      checkpoint,
      metadata,
    });
    const cipher = this.repository.codec.encode(
      bytes,
      this.identity(namespace, checkpoint.id),
    );
    await this.repository.fenced(this.lease, async (client) => {
      await client.query(
        `INSERT INTO workflow_checkpoints(tenant_id,actor_id,run_id,graph_name,namespace,checkpoint_id,parent_id,encoding,cipher)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) ON CONFLICT DO NOTHING`,
        [
          ...this.params(),
          namespace,
          checkpoint.id,
          config.configurable?.checkpoint_id ?? null,
          encoding,
          cipher,
        ],
      );
      // Keep two full snapshots. Safe metrics live separately; raw state is not an audit log.
      await client.query(
        `DELETE FROM workflow_checkpoints WHERE tenant_id=$1 AND actor_id=$2 AND run_id=$3 AND graph_name=$4 AND namespace=$5
        AND checkpoint_id NOT IN(SELECT checkpoint_id FROM workflow_checkpoints WHERE tenant_id=$1 AND actor_id=$2 AND run_id=$3 AND graph_name=$4 AND namespace=$5 ORDER BY checkpoint_id DESC LIMIT 2)`,
        [...this.params(), namespace],
      );
      await client.query(
        `DELETE FROM workflow_writes WHERE tenant_id=$1 AND actor_id=$2 AND run_id=$3 AND graph_name=$4 AND namespace=$5
        AND checkpoint_id<(SELECT min(checkpoint_id) FROM workflow_checkpoints WHERE tenant_id=$1 AND actor_id=$2 AND run_id=$3 AND graph_name=$4 AND namespace=$5)`,
        [...this.params(), namespace],
      );
      await this.repository.checkStateSize(client, this.lease);
    });
    return this.config(namespace, checkpoint.id);
  }

  async putWrites(
    ...[config, writes, taskId, taskPath = ""]: Parameters<
      BaseCheckpointSaver["putWrites"]
    >
  ): Promise<void> {
    const namespace = this.scope(config),
      id = config.configurable?.checkpoint_id;
    if (typeof id !== "string")
      throw new WorkflowGuardError("definition_changed");
    const rows = await Promise.all(
      writes.map(async ([channel, value], index) => {
        const ordinal = slots[channel] ?? index;
        const [encoding, bytes] = await this.serde.dumpsTyped([channel, value]);
        return {
          ordinal,
          encoding,
          cipher: this.repository.codec
            .encode(
              bytes,
              this.identity(namespace, id, taskId, String(ordinal)),
            )
            .toString("base64"),
        };
      }),
    );
    if (!rows.length) return;
    await this.repository.fenced(this.lease, async (client) => {
      await client.query(
        `INSERT INTO workflow_writes(tenant_id,actor_id,run_id,graph_name,namespace,checkpoint_id,task_id,task_path,ordinal,encoding,cipher)
        SELECT $1,$2,$3,$4,$5,$6,$7,$8,x.ordinal,x.encoding,decode(x.cipher,'base64')
        FROM jsonb_to_recordset($9::jsonb) x(ordinal int,encoding text,cipher text)
        ON CONFLICT(tenant_id,actor_id,run_id,graph_name,namespace,checkpoint_id,task_id,ordinal)
        DO UPDATE SET encoding=EXCLUDED.encoding,cipher=EXCLUDED.cipher,task_path=EXCLUDED.task_path WHERE workflow_writes.ordinal<0`,
        [
          ...this.params(),
          namespace,
          id,
          taskId,
          taskPath,
          JSON.stringify(rows),
        ],
      );
      await this.repository.checkStateSize(client, this.lease);
    });
  }
  async deleteThread(_threadId: string): Promise<void> {
    throw new Error("Workflow deletion uses scoped retention cleanup.");
  }
}
