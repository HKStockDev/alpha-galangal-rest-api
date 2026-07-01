import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { OrganizationsModule } from '../organizations/organizations.module';
import { OrganizationMultiFormulaScreenerController } from './organization-multi-formula-screener.controller';
import { OrganizationWatchlistSecuritiesController } from './organization-watchlist-securities.controller';
import { OrganizationWatchlistsController } from './organization-watchlists.controller';
import { WatchlistsService } from './watchlists.service';

@Module({
  imports: [AuthModule, OrganizationsModule],
  controllers: [
    OrganizationMultiFormulaScreenerController,
    OrganizationWatchlistsController,
    OrganizationWatchlistSecuritiesController,
  ],
  providers: [WatchlistsService],
  exports: [WatchlistsService],
})
export class WatchlistsModule {}
