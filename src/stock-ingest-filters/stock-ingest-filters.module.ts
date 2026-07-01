import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { StockIngestFiltersController } from './stock-ingest-filters.controller';
import { StockIngestFiltersService } from './stock-ingest-filters.service';

@Module({
  imports: [AuthModule],
  controllers: [StockIngestFiltersController],
  providers: [StockIngestFiltersService],
  exports: [StockIngestFiltersService],
})
export class StockIngestFiltersModule {}
