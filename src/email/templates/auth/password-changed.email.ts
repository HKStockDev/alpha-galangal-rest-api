import { escapeHtml } from '../marketing/contact/escape-html';
import { renderTransactionalEmailLayout } from '../shared/transactional-layout';
import type { PasswordChangedEmailContext } from './types';

const SUBJECT = 'Your Conviction password was changed';

export function renderPasswordChangedEmail(ctx: PasswordChangedEmailContext): {
  subject: string;
  html: string;
  text: string;
} {
  const changedAt = ctx.changedAt.toLocaleString('en-US', {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: 'UTC',
  });

  const bodyHtml = `
    <p style="margin:0 0 12px 0;">Your Conviction account password was changed on <strong>${escapeHtml(changedAt)} UTC</strong>.</p>
    <p style="margin:0;">If you did not make this change, contact support immediately and reset your password.</p>
  `;

  const text = `Your Conviction account password was changed on ${changedAt} UTC.

If you did not make this change, contact support immediately and reset your password.

Account settings: ${ctx.settingsUrl}

— The Conviction team`;

  return {
    subject: SUBJECT,
    html: renderTransactionalEmailLayout({
      preheader: 'Your Conviction password was changed.',
      title: 'Password changed',
      bodyHtml,
      ctaLabel: 'Account settings →',
      ctaUrl: ctx.settingsUrl,
    }),
    text,
  };
}
