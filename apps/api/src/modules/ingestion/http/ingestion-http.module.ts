import { Module } from '@nestjs/common';
import { WorkspaceRoleGuard } from '../../../platform/http/nest-workspace.guard.js';
import { IngestionController } from '../ingestion.controller.js';
@Module({ controllers: [IngestionController], providers: [WorkspaceRoleGuard] })
export class IngestionHttpModule {
}
