import { Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DEFAULT_FRONTEND_BASE_URL } from '../config/app-urls';
import { EmailService } from '../email/email.service';
import { renderPasswordChangedEmail } from '../email/templates/auth/password-changed.email';
import { renderPasswordResetEmail } from '../email/templates/auth/password-reset.email';
import { renderSignupVerificationEmail } from '../email/templates/auth/signup-verification.email';
import { escapeHtml } from '../email/templates/marketing/contact/escape-html';
import { renderTransactionalEmailLayout } from '../email/templates/shared/transactional-layout';
import { maskEmailForLogs } from '../email/email-log.util';
import type { SupabaseEmailActionType } from './supabase-confirmation-url.util';

@Injectable()
export class AuthEmailService {
  private readonly logger = new Logger(AuthEmailService.name);
  private readonly frontendUrl: string;
  private readonly fromEmail: string;

  constructor(
    private readonly config: ConfigService,
    private readonly emailService: EmailService,
  ) {
    this.frontendUrl = (
      this.config.get<string>('invitations.frontendUrl') ?? DEFAULT_FRONTEND_BASE_URL
    ).replace(/\/$/, '');
    this.fromEmail =
      this.config.get<string>('invitations.fromEmail') ?? 'alex@withprecision.ai';
  }

  private settingsUrl(): string {
    return `${this.frontendUrl}/org/dashboard/settings`;
  }

  async sendPasswordResetEmail(
    to: string,
    resetUrl: string,
    expiresMinutes: number,
  ): Promise<void> {
    const { subject, html, text } = renderPasswordResetEmail({
      resetUrl,
      expiresMinutes,
    });

    const result = await this.emailService.send({
      to,
      subject,
      html,
      text,
      from: this.fromEmail,
    });

    if (!result.success) {
      this.logger.warn(
        `password-reset: email send failed maskedEmail=${maskEmailForLogs(to)} reason=${result.error ?? 'unknown'}`,
      );
      throw new ServiceUnavailableException(
        result.error ?? 'Unable to send password reset email',
      );
    }
  }

  async sendPasswordChangedEmail(to: string, changedAt: Date): Promise<void> {
    const { subject, html, text } = renderPasswordChangedEmail({
      changedAt,
      settingsUrl: this.settingsUrl(),
    });

    if (!this.emailService.isConfigured()) {
      this.logger.warn(
        `RESEND_API_KEY not set; skipping password-changed email to ${maskEmailForLogs(to)}`,
      );
      return;
    }

    const result = await this.emailService.send({
      to,
      subject,
      html,
      text,
      from: this.fromEmail,
    });

    if (!result.success) {
      this.logger.warn(
        `password-changed: email send failed maskedEmail=${maskEmailForLogs(to)} reason=${result.error ?? 'unknown'}`,
      );
    }
  }

  async sendSignupVerificationEmail(to: string, confirmUrl: string): Promise<void> {
    const { subject, html, text } = renderSignupVerificationEmail({ confirmUrl });

    const result = await this.emailService.send({
      to,
      subject,
      html,
      text,
      from: this.fromEmail,
    });

    if (!result.success) {
      this.logger.warn(
        `signup-verification: email send failed maskedEmail=${maskEmailForLogs(to)} reason=${result.error ?? 'unknown'}`,
      );
      throw new ServiceUnavailableException(
        result.error ?? 'Unable to send signup verification email',
      );
    }
  }

  async sendReauthenticationCodeEmail(to: string, code: string): Promise<void> {
    const safeCode = escapeHtml(code);
    const bodyHtml = `<p style="margin:0 0 12px 0;">Your Precision verification code is:</p>
      <p style="margin:0;font-size:24px;font-weight:700;letter-spacing:0.2em;">${safeCode}</p>
      <p style="margin:16px 0 0 0;">This code expires shortly. If you did not request it, you can ignore this email.</p>`;
    const text = `Your Precision verification code is: ${code}\n\nThis code expires shortly.`;

    const result = await this.emailService.send({
      to,
      subject: 'Your Precision verification code',
      html: renderTransactionalEmailLayout({
        preheader: 'Use this code to verify your identity.',
        title: 'Verification code',
        bodyHtml,
      }),
      text,
      from: this.fromEmail,
    });

    if (!result.success) {
      throw new ServiceUnavailableException(result.error ?? 'Unable to send verification code email');
    }
  }

  async sendGenericAuthConfirmationEmail(
    to: string,
    confirmUrl: string,
    action: SupabaseEmailActionType,
  ): Promise<void> {
    const title = 'Confirm your request';
    const safeUrl = escapeHtml(confirmUrl);
    const bodyHtml = `<p style="margin:0 0 12px 0;">Follow the link below to continue.</p>
      <p style="margin:16px 0 0 0;word-break:break-all;"><a href="${safeUrl}">${safeUrl}</a></p>`;
    const text = `Follow this link to continue: ${confirmUrl}`;

    const result = await this.emailService.send({
      to,
      subject: `Precision — ${title}`,
      html: renderTransactionalEmailLayout({
        preheader: `Complete your ${action.replace(/_/g, ' ')} request.`,
        title,
        bodyHtml,
        ctaLabel: 'Continue →',
        ctaUrl: confirmUrl,
      }),
      text,
      from: this.fromEmail,
    });

    if (!result.success) {
      throw new ServiceUnavailableException(result.error ?? 'Unable to send auth email');
    }
  }
}
