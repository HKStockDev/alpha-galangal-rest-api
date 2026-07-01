import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { ExposuresController } from './exposures.controller';
import { ExposuresService } from './exposures.service';

@Module({
  imports: [AuthModule],
  controllers: [ExposuresController],
  providers: [ExposuresService],
  exports: [ExposuresService],
})
export class ExposuresModule {}
