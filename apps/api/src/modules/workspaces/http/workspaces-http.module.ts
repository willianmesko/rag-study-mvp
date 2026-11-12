import { Module } from '@nestjs/common';
import { WorkspaceRoleGuard } from '../../../platform/http/nest-workspace.guard.js';
import { WorkspaceTeamController } from '../workspace-team.controller.js';
import { WorkspacesController } from '../workspaces.controller.js';
@Module({ controllers: [WorkspacesController, WorkspaceTeamController], providers: [WorkspaceRoleGuard] })
export class WorkspacesHttpModule {
}
