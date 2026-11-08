import { workspaceGuideSteps, workspaceOnboardingProgressSchema, type WorkspaceOnboardingProgress } from "@rag-study/contracts";
import type { Pool } from "pg";
import { z } from "zod";
import { decodeStoredRecord } from "../../../../platform/database/stored-record.js";
import type { WorkspaceOnboardingRepository, WorkspaceOnboardingScope } from "../../application/ports/workspace-onboarding-repository.js";

const progressRow = z.object({
  goal: workspaceOnboardingProgressSchema.shape.goal,
  furthest_step: z.number().int().min(0).max(workspaceGuideSteps.length - 1),
  completed: z.boolean()
}).transform((row) => ({ goal: row.goal, step: workspaceGuideSteps[row.furthest_step], completed: row.completed }))
  .pipe(workspaceOnboardingProgressSchema);

function fromRow(row: unknown): WorkspaceOnboardingProgress {
  return decodeStoredRecord(progressRow, row);
}

export class PgWorkspaceOnboardingRepository implements WorkspaceOnboardingRepository {
  constructor(private readonly pool: Pool) {}

  async get({ tenantId, userId }: WorkspaceOnboardingScope): Promise<WorkspaceOnboardingProgress | null> {
    const { rows } = await this.pool.query<Record<string, unknown>>(
      "SELECT goal, furthest_step, completed FROM workspace_onboarding WHERE tenant_id = $1 AND user_id = $2",
      [tenantId, userId]
    );
    return rows.length ? fromRow(rows[0]) : null;
  }

  async save({ tenantId, userId }: WorkspaceOnboardingScope, progress: WorkspaceOnboardingProgress): Promise<WorkspaceOnboardingProgress> {
    const { rows } = await this.pool.query<Record<string, unknown>>(
      `INSERT INTO workspace_onboarding (tenant_id, user_id, goal, furthest_step, completed)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (tenant_id, user_id) DO UPDATE SET
         goal = CASE
           WHEN workspace_onboarding.completed OR EXCLUDED.furthest_step < workspace_onboarding.furthest_step
             THEN workspace_onboarding.goal
           ELSE COALESCE(EXCLUDED.goal, workspace_onboarding.goal)
         END,
         furthest_step = GREATEST(workspace_onboarding.furthest_step, EXCLUDED.furthest_step),
         completed = workspace_onboarding.completed OR EXCLUDED.completed
       RETURNING goal, furthest_step, completed`,
      [tenantId, userId, progress.goal, workspaceGuideSteps.indexOf(progress.step), progress.completed]
    );
    return fromRow(rows[0]);
  }
}
