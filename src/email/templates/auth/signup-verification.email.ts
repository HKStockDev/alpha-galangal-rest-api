import { escapeHtml } from '../marketing/contact/escape-html';
import { renderTransactionalEmailLayout } from '../shared/transactional-layout';
import type { SignupVerificationEmailContext } from './types';

const SUBJECT = 'Verify your Conviction account';

export function renderSignupVerificationEmail(ctx: SignupVerificationEmailContext): {
  subject: string;
  html: string;
  text: string;
} {
  const confirmUrl = escapeHtml(ctx.confirmUrl);

  const bodyHtml = `
    <p style="margin:0 0 12px 0;">Thanks for signing up for Conviction.</p>
    <p style="margin:0 0 12px 0;">Confirm your email address to finish creating your account and continue setup.</p>
    <p style="margin:0;">If you did not create an account, you can safely ignore this email.</p>
    <p style="margin:16px 0 0 0;word-break:break-all;"><a href="${confirmUrl}" style="color:#4f46e5;">${confirmUrl}</a></p>
  `;

  const text = `Thanks for signing up for Conviction.

Confirm your email address: ${ctx.confirmUrl}

If you did not create an account, you can safely ignore this email.

— The Conviction team`;

  return {
    subject: SUBJECT,
    html: renderTransactionalEmailLayout({
      preheader: 'Confirm your email to finish signing up for Conviction.',
      title: 'Verify your email',
      bodyHtml,
      ctaLabel: 'Verify email →',
      ctaUrl: ctx.confirmUrl,
    }),
    text,
  };
}
