import {
  BadRequestException,
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DEFAULT_FRONTEND_BASE_URL } from '../config/app-urls';
import { Webhook } from 'standardwebhooks';
import { maskEmailForLogs } from '../email/email-log.util';
import { AuthEmailService } from './auth-email.service';
import {
  SUPABASE_AUTH_NOTIFICATION_EMAIL_TYPES,
  SupabaseSendEmailHookEmailData,
  buildAppHostedSignupConfirmationUrl,
  buildSupabaseConfirmationUrl,
} from './supabase-confirmation-url.util';

type SendEmailHookUser = {
  email: string;
  new_email?: string;
};

type SendEmailHookPayload = {
  user: SendEmailHookUser;
  email_data: SupabaseSendEmailHookEmailData;
};

@Injectable()
export class AuthSendEmailHookService {
  private readonly logger = new Logger(AuthSendEmailHookService.name);
  private readonly webhook: Webhook | null;

  constructor(
    private readonly config: ConfigService,
    private readonly authEmailService: AuthEmailService,
  ) {
    const secret = this.config.get<string>('supabase.sendEmailHookSecret');
    this.webhook = secret ? new Webhook(secret) : null;
  }

  isConfigured(): boolean {
    return this.webhook != null;
  }

  async handleSendEmailHook(rawBody: string, headers: Record<string, string>): Promise<Record<string, never>> {
    if (!this.webhook) {
      throw new BadRequestException('Supabase send-email hook is not configured');
    }

    let payload: SendEmailHookPayload;
    try {
      payload = this.webhook.verify(rawBody, headers) as SendEmailHookPayload;
    } catch (err) {
      this.logger.warn(
        `send-email hook: signature verification failed err=${err instanceof Error ? err.message : String(err)}`,
      );
      throw new UnauthorizedException('Invalid hook signature');
    }

    const { user, email_data: emailData } = payload;
    const action = emailData.email_action_type;
    const maskedEmail = maskEmailForLogs(user.email);

    if (SUPABASE_AUTH_NOTIFICATION_EMAIL_TYPES.has(action)) {
      this.logger.log(`send-email hook: skipped notification type=${action} maskedEmail=${maskedEmail}`);
      return {};
    }

    const supabaseUrl = this.config.getOrThrow<string>('supabase.url');
    const frontendUrl =
      this.config.get<string>('invitations.frontendUrl') ?? DEFAULT_FRONTEND_BASE_URL;
    const redirectTo = emailData.redirect_to || `${frontendUrl.replace(/\/+$/, '')}/auth/callback`;
    const supabaseConfirmUrl = buildSupabaseConfirmationUrl(supabaseUrl, {
      ...emailData,
      redirect_to: redirectTo,
    });

    if (action === 'signup') {
      const confirmUrl = buildAppHostedSignupConfirmationUrl(frontendUrl, emailData, user.email);
      await this.authEmailService.sendSignupVerificationEmail(user.email, confirmUrl);
      this.logger.log(`send-email hook: signup verification sent maskedEmail=${maskedEmail}`);
      return {};
    }

    if (action === 'reauthentication') {
      await this.authEmailService.sendReauthenticationCodeEmail(user.email, emailData.token);
      this.logger.log(`send-email hook: reauthentication code sent maskedEmail=${maskedEmail}`);
      return {};
    }

    this.logger.warn(
      `send-email hook: unhandled action type=${action} maskedEmail=${maskedEmail}; sending generic confirmation email`,
    );
    await this.authEmailService.sendGenericAuthConfirmationEmail(
      user.email,
      supabaseConfirmUrl,
      action,
    );
    return {};
  }
}
