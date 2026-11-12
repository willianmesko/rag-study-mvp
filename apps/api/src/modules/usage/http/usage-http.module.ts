import { Module } from '@nestjs/common';
import { WorkspaceRoleGuard } from '../../../platform/http/nest-workspace.guard.js';
import { OperationsController } from '../operations.controller.js';
@Module({ controllers: [OperationsController], providers: [WorkspaceRoleGuard] })
export class UsageHttpModule {
}
