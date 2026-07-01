import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { SignalCategoriesController } from './signal-categories.controller';
import { SignalCategoriesService } from './signal-categories.service';

@Module({
  imports: [AuthModule],
  controllers: [SignalCategoriesController],
  providers: [SignalCategoriesService],
  exports: [SignalCategoriesService],
})
export class SignalCategoriesModule {}
