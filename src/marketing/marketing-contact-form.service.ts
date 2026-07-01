import {
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { EmailService } from '../email/email.service';
import { renderSubmitterAcknowledgmentEmail } from '../email/templates/marketing/contact/submitter-acknowledgment.email';
import { renderTeamNotificationEmail } from '../email/templates/marketing/contact/team-notification.email';
import type { MarketingContactFormPayload } from '../email/templates/marketing/contact/types';
import type { ContactFormSubmissionDto } from './dto/contact-form-submission.dto';

@Injectable()
export class MarketingContactFormService {
  private readonly logger = new Logger(MarketingContactFormService.name);

  constructor(
    private readonly email: EmailService,
    private readonly config: ConfigService,
  ) {}

  async submit(dto: ContactFormSubmissionDto): Promise<{ ok: true }> {
    if (!this.email.isConfigured()) {
      throw new ServiceUnavailableException(
        'Email delivery is not configured. Set RESEND_API_KEY on the API server.',
      );
    }

    const payload: MarketingContactFormPayload = {
      name: dto.name.trim(),
      firm: dto.firm.trim(),
      email: dto.email.trim().toLowerCase(),
      role: dto.role.trim(),
      message: dto.message.trim(),
    };

    const notifyTo = this.config.get<string>('marketing.contactForm.notifyEmail')?.trim();
    if (!notifyTo) {
      throw new ServiceUnavailableException('CONTACT_FORM_NOTIFY_EMAIL is not configured.');
    }

    const ack = renderSubmitterAcknowledgmentEmail(payload);
    const toSubmitter = await this.email.send({
      to: payload.email,
      subject: ack.subject,
      html: ack.html,
      text: ack.text,
    });
    if (!toSubmitter.success) {
      this.logger.warn(`Contact form: submitter email failed: ${toSubmitter.error}`);
      throw new ServiceUnavailableException(
        toSubmitter.error ?? 'Could not send confirmation email. Try again later.',
      );
    }

    const internal = renderTeamNotificationEmail(payload);
    const toTeam = await this.email.send({
      to: notifyTo,
      subject: internal.subject,
      html: internal.html,
      text: internal.text,
    });
    if (!toTeam.success) {
      this.logger.error(
        `Contact form: team notify failed after submitter ok to=${notifyTo} err=${toTeam.error}`,
      );
      throw new ServiceUnavailableException(
        'Your message was received, but we could not alert our team automatically. Please email hello@conviction.com.',
      );
    }

    return { ok: true };
  }
}
