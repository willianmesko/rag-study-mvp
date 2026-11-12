import { Module } from '@nestjs/common';
import { WorkspaceRoleGuard } from '../../../platform/http/nest-workspace.guard.js';
import { EvaluationsController } from '../evaluations.controller.js';
@Module({ controllers: [EvaluationsController], providers: [WorkspaceRoleGuard] })
export class EvaluationsHttpModule {
}
