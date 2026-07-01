import { escapeHtml } from '../marketing/contact/escape-html';
import { renderTransactionalEmailLayout } from '../shared/transactional-layout';
import type { PasswordResetEmailContext } from './types';

const SUBJECT = 'Reset your Precision password';

export function renderPasswordResetEmail(ctx: PasswordResetEmailContext): {
  subject: string;
  html: string;
  text: string;
} {
  const resetUrl = escapeHtml(ctx.resetUrl);

  const bodyHtml = `
    <p style="margin:0 0 12px 0;">You requested a password reset for your Precision account.</p>
    <p style="margin:0 0 12px 0;">This link expires in <strong>${ctx.expiresMinutes} minutes</strong> and can only be used once.</p>
    <p style="margin:0;">If you did not request this, you can safely ignore this email.</p>
    <p style="margin:16px 0 0 0;word-break:break-all;"><a href="${resetUrl}" style="color:#4f46e5;">${resetUrl}</a></p>
  `;

  const text = `You requested a password reset for your Precision account.

Reset your password: ${ctx.resetUrl}

This link expires in ${ctx.expiresMinutes} minutes and can only be used once.

If you did not request this, you can safely ignore this email.

— The Precision team`;

  return {
    subject: SUBJECT,
    html: renderTransactionalEmailLayout({
      preheader: 'Use this link to reset your Precision password.',
      title: 'Reset your password',
      bodyHtml,
      ctaLabel: 'Reset password →',
      ctaUrl: ctx.resetUrl,
    }),
    text,
  };
}
