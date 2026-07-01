import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DEFAULT_FRONTEND_BASE_URL } from '../../config/app-urls';
import { EmailService } from '../../email/email.service';

export interface SendInviteEmailParams {
  to: string;
  organizationName: string;
  inviterName: string;
  role: string;
  inviteUrl: string;
  expiresAt?: Date | null;
}

@Injectable()
export class InvitationEmailService {
  private readonly frontendUrl: string;
  private readonly fromEmail: string;

  constructor(
    private config: ConfigService,
    private emailService: EmailService,
  ) {
    this.frontendUrl = (this.config.get<string>('invitations.frontendUrl') ?? DEFAULT_FRONTEND_BASE_URL).replace(/\/$/, '');
    this.fromEmail =
      this.config.get<string>('invitations.fromEmail') ?? 'alex@withprecision.ai';
    
  }

  buildInviteUrl(token: string): string {
    return `${this.frontendUrl}/invite/${token}`;
  }

  async sendInviteEmail(params: SendInviteEmailParams): Promise<void> {
    const { to, organizationName, inviterName, role, inviteUrl, expiresAt } = params;
    const expiresText = expiresAt
      ? `This invitation expires on ${expiresAt.toLocaleDateString()}.`
      : '';

    const html = `
      <p>You've been invited to join <strong>${escapeHtml(organizationName)}</strong> as <strong>${escapeHtml(role)}</strong> by ${escapeHtml(inviterName)}.</p>
      <p>${expiresText}</p>
      <p><a href="${escapeHtml(inviteUrl)}" style="display:inline-block;padding:10px 20px;background:#4f46e5;color:white;text-decoration:none;border-radius:6px;">Accept invitation</a></p>
      <p>If the button doesn't work, copy and paste this link into your browser:</p>
      <p><a href="${escapeHtml(inviteUrl)}">${escapeHtml(inviteUrl)}</a></p>
    `;

    const result = await this.emailService.send({
      to,
      subject: `Invitation to join ${organizationName}`,
      html,
      from: this.fromEmail,
    });

    if (!result.success && result.error) {
      throw new Error(result.error);
    }
  }
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
