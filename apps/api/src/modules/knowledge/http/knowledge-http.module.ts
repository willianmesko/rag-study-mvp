import { Module } from '@nestjs/common';
import { WorkspaceRoleGuard } from '../../../platform/http/nest-workspace.guard.js';
import { DocumentsController } from '../documents.controller.js';
import { SearchController } from '../search.controller.js';
@Module({ controllers: [DocumentsController, SearchController], providers: [WorkspaceRoleGuard] })
export class KnowledgeHttpModule {
}
