import { Module } from '@nestjs/common';
import { WorkspaceRoleGuard } from '../../../platform/http/nest-workspace.guard.js';
import { ChatModelsController } from '../chat-models.controller.js';
import { ChatController } from '../chat.controller.js';
import { ConversationsController } from "../conversations.controller.js";
@Module({})
export class ChatHttpModule {
    static register(conversations: boolean) {
        return { module: ChatHttpModule, controllers: [ChatModelsController, ChatController, ...(conversations ? [ConversationsController] : [])], providers: [WorkspaceRoleGuard] };
    }
}
