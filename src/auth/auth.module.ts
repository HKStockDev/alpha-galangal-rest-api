import { Module } from '@nestjs/common';
import { AuthController } from './auth.controller';
import { AuthEmailService } from './auth-email.service';
import { AuthSendEmailHookController } from './auth-send-email-hook.controller';
import { AuthSendEmailHookService } from './auth-send-email-hook.service';
import { AuthService } from './auth.service';
import { PlatformAdminGuard } from './guards/platform-admin.guard';

@Module({
  controllers: [AuthController, AuthSendEmailHookController],
  providers: [AuthService, AuthEmailService, AuthSendEmailHookService, PlatformAdminGuard],
  exports: [AuthService, AuthEmailService, AuthSendEmailHookService, PlatformAdminGuard],
})
export class AuthModule {}
