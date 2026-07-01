import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ThrottlerModule } from '@nestjs/throttler';
import configuration from './config/configuration';
import { validateEnv } from './config/env.validation';
import { SupabaseModule } from './supabase/supabase.module';
import { AuthModule } from './auth/auth.module';
import { CongressModule } from './congress/congress.module';
import { FmpModule } from './fmp/fmp.module';
import { FormulasModule } from './formulas/formulas.module';
import { HedgeFundsModule } from './hedge-funds/hedge-funds.module';
import { MassiveModule } from './massive/massive.module';
import { EmailModule } from './email/email.module';
import { OrganizationsModule } from './organizations/organizations.module';
import { ClientsModule } from './clients/clients.module';
import { LlmChatsModule } from './llm-chats/llm-chats.module';
import { WatchlistsModule } from './watchlists/watchlists.module';
import { StockIngestFiltersModule } from './stock-ingest-filters/stock-ingest-filters.module';
import { FundamentalConstrictionModule } from './fundamental-constriction/fundamental-constriction.module';
import { PoliticalScoreModule } from './political-score/political-score.module';
import { ExposuresModule } from './exposures/exposures.module';
import { TagsModule } from './tags/tags.module';
import { DataSyncModule } from './data-sync/data-sync.module';
import { FormulaMarketingModule } from './formula-marketing/formula-marketing.module';
import { TaxonomyMarketingModule } from './taxonomy-marketing/taxonomy-marketing.module';
import { MarketingSearchModule } from './marketing-search/marketing-search.module';
import { NetExposureScoreModule } from './net-exposure-score/net-exposure-score.module';
import { InsiderConvictionScoreModule } from './insider-conviction-score/insider-conviction-score.module';
import { BuffettScoreModule } from './buffett-score/buffett-score.module';
import { AmericaFirstScoreModule } from './america-first-score/america-first-score.module';
import { DruckenmillerScoreModule } from './druckenmiller-score/druckenmiller-score.module';
import { WoodScoreModule } from './wood-score/wood-score.module';
import { BurryScoreModule } from './burry-score/burry-score.module';
import { GrahamScoreModule } from './graham-score/graham-score.module';
import { LynchScoreModule } from './lynch-score/lynch-score.module';
import { JobsModule } from './jobs/jobs.module';
import { SignalCategoriesModule } from './signal-categories/signal-categories.module';
import { IntegrationsSocialModule } from './integrations/social/integrations-social.module';
import { MarketingModule } from './marketing/marketing.module';
import { BillingModule } from './billing/billing.module';
import { AssistantAdminModule } from './assistant-admin/assistant-admin.module';
import { MonetizationAdminModule } from './monetization-admin/monetization-admin.module';
import { CreditsModule } from './credits/credits.module';
import { AssistantModule } from './assistant/assistant.module';
import { TestLogModule } from './common/test-log.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      load: [configuration],
      validate: validateEnv,
      envFilePath: ['.env.development', '.env'],
    }),
    ThrottlerModule.forRoot([
      {
        name: 'auth',
        ttl: 60000,
        limit: 5,
      },
      {
        name: 'contact',
        ttl: 60000,
        limit: 5,
      },
    ]),
    TestLogModule,
    SupabaseModule,
    EmailModule,
    AuthModule,
    HedgeFundsModule,
    FormulasModule,
    FmpModule,
    MassiveModule,
    CongressModule,
    OrganizationsModule,
    ClientsModule,
    LlmChatsModule,
    WatchlistsModule,
    StockIngestFiltersModule,
    FundamentalConstrictionModule,
    PoliticalScoreModule,
    NetExposureScoreModule,
    InsiderConvictionScoreModule,
    BuffettScoreModule,
    AmericaFirstScoreModule,
    DruckenmillerScoreModule,
    WoodScoreModule,
    BurryScoreModule,
    GrahamScoreModule,
    LynchScoreModule,
    ExposuresModule,
    TagsModule,
    DataSyncModule,
    FormulaMarketingModule,
    TaxonomyMarketingModule,
    MarketingSearchModule,
    SignalCategoriesModule,
    JobsModule,
    IntegrationsSocialModule,
    MarketingModule,
    BillingModule,
    AssistantAdminModule,
    MonetizationAdminModule,
    CreditsModule,
    AssistantModule,
  ],
})
export class AppModule {}
