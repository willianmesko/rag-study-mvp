import { workspaceGuideSteps, type WorkspaceOnboardingProgress } from "@rag-study/contracts";
import type { Pool } from "pg";
import type { WorkspaceOnboardingRepository, WorkspaceOnboardingScope } from "../../application/ports/workspace-onboarding-repository.js";

type ProgressRow = {
  goal: WorkspaceOnboardingProgress["goal"];
  furthest_step: number;
  completed: boolean;
};

function fromRow(row: ProgressRow): WorkspaceOnboardingProgress {
  return { goal: row.goal, step: workspaceGuideSteps[row.furthest_step], completed: row.completed };
}

export class PgWorkspaceOnboardingRepository implements WorkspaceOnboardingRepository {
  constructor(private readonly pool: Pool) {}

  async get({ tenantId, userId }: WorkspaceOnboardingScope): Promise<WorkspaceOnboardingProgress | null> {
    const { rows } = await this.pool.query<ProgressRow>(
      "SELECT goal, furthest_step, completed FROM workspace_onboarding WHERE tenant_id = $1 AND user_id = $2",
      [tenantId, userId]
    );
    return rows[0] ? fromRow(rows[0]) : null;
  }

  async save({ tenantId, userId }: WorkspaceOnboardingScope, progress: WorkspaceOnboardingProgress): Promise<WorkspaceOnboardingProgress> {
    const { rows } = await this.pool.query<ProgressRow>(
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
