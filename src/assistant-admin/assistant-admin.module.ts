import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { AssistantAdminController } from './assistant-admin.controller';
import { AssistantAdminService } from './assistant-admin.service';

@Module({
  imports: [AuthModule],
  controllers: [AssistantAdminController],
  providers: [AssistantAdminService],
})
export class AssistantAdminModule {}
