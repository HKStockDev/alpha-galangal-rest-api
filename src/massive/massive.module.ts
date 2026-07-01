import { Module, forwardRef } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { FmpModule } from '../fmp/fmp.module';
import { MassiveController } from './massive.controller';
import { SecurityEnrichmentService } from './security-enrichment.service';
import { MassiveService } from './massive.service';

@Module({
  imports: [AuthModule, forwardRef(() => FmpModule)],
  controllers: [MassiveController],
  providers: [MassiveService, SecurityEnrichmentService],
  exports: [MassiveService, SecurityEnrichmentService],
})
export class MassiveModule {}
