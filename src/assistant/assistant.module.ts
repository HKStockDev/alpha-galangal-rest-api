import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { BillingModule } from '../billing/billing.module';
import { ClientsModule } from '../clients/clients.module';
import { CreditsModule } from '../credits/credits.module';
import { EntitlementsModule } from '../entitlements/entitlements.module';
import { LlmChatsModule } from '../llm-chats/llm-chats.module';
import { OrganizationsModule } from '../organizations/organizations.module';
import { WatchlistsModule } from '../watchlists/watchlists.module';
import { AssistantCacheService } from './assistant-cache.service';
import { AssistantPendingActionService } from './assistant-pending-action.service';
import { AssistantRuntimeService } from './assistant-runtime.service';
import { AssistantToolExecutorService } from './assistant-tool-executor.service';
import { AssistantToolPolicyService } from './assistant-tool-policy.service';
import { AssistantToolRegistryService } from './assistant-tool-registry.service';
import { AssistantService } from './assistant.service';
import { EmbeddingService } from './embedding.service';
import { KnowledgeIndexService } from './knowledge-index.service';
import { KnowledgeSearchService } from './knowledge-search.service';
import { OrganizationAssistantController } from './organization-assistant.controller';

@Module({
  imports: [
    AuthModule,
    OrganizationsModule,
    BillingModule,
    CreditsModule,
    EntitlementsModule,
    LlmChatsModule,
    ClientsModule,
    WatchlistsModule,
  ],
  controllers: [OrganizationAssistantController],
  providers: [
    AssistantService,
    AssistantRuntimeService,
    AssistantToolRegistryService,
    AssistantToolExecutorService,
    AssistantToolPolicyService,
    AssistantPendingActionService,
    AssistantCacheService,
    EmbeddingService,
    KnowledgeIndexService,
    KnowledgeSearchService,
  ],
})
export class AssistantModule {}
