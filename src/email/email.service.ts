import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Resend } from 'resend';
import { SendEmailDto } from './dto/send-email.dto';

export interface SendEmailResult {
  id: string | null;
  success: boolean;
  error?: string;
}

@Injectable()
export class EmailService {
  private readonly logger = new Logger(EmailService.name);
  private resend: Resend | null = null;
  private readonly defaultFrom: string;
  private readonly fallbackFrom = 'onboarding@resend.dev';

  constructor(private config: ConfigService) {
    const apiKey = this.config.get<string>('invitations.resendApiKey');
    if (apiKey) {
      this.resend = new Resend(apiKey);
    }
    this.defaultFrom =
      this.config.get<string>('invitations.fromEmail') ?? 'alex@withconviction.ai';
  }

  isConfigured(): boolean {
    return this.resend !== null;
  }

  async send(dto: SendEmailDto): Promise<SendEmailResult> {
    if (!this.resend) {
      this.logger.warn('RESEND_API_KEY not set; skipping email. To:', dto.to);
      return { id: null, success: false, error: 'Email service not configured' };
    }

    try {
      const primaryFrom = dto.from ?? this.defaultFrom;
      let { data, error } = await this.resend.emails.send({
        from: primaryFrom,
        to: dto.to,
        subject: dto.subject,
        html: dto.html,
        text: dto.text,
      });

      // Common operational issue: custom domain not yet verified in Resend.
      // Retry once with Resend's default sender so password-reset can proceed.
      if (error && this.shouldRetryWithFallbackFrom(error, primaryFrom)) {
        this.logger.warn(
          `Primary sender domain rejected by Resend; retrying with fallback sender (${this.fallbackFrom}).`,
        );
        const retry = await this.resend.emails.send({
          from: this.fallbackFrom,
          to: dto.to,
          subject: dto.subject,
          html: dto.html,
          text: dto.text,
        });
        data = retry.data;
        error = retry.error;
      }

      if (error) {
        this.logger.error(
          `Resend error (from=${primaryFrom}): ${JSON.stringify(error)}`,
        );
        return {
          id: null,
          success: false,
          error:
            error.message ??
            'Resend rejected the email. Check sender domain verification and API key permissions.',
        };
      }

      return { id: data?.id ?? null, success: true };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.error(`Failed to send email to ${dto.to}: ${msg}`);
      return { id: null, success: false, error: msg };
    }
  }

  private shouldRetryWithFallbackFrom(error: unknown, attemptedFrom: string): boolean {
    if (!attemptedFrom || attemptedFrom.toLowerCase() === this.fallbackFrom.toLowerCase()) {
      return false;
    }
    const err = error as { statusCode?: number; message?: string; name?: string };
    const msg = (err.message ?? '').toLowerCase();
    return (
      err.statusCode === 403 &&
      (msg.includes('domain is not verified') || msg.includes('verify your domain'))
    );
  }
}
