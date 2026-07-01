import { escapeHtml } from '../marketing/contact/escape-html';
import { formatEmailDate } from '../shared/format-date';
import { renderTransactionalEmailLayout } from '../shared/transactional-layout';
import type { BillingEmailContext } from './types';

const SUBJECT = 'Your Conviction free trial has ended';

export function renderTrialEndedEmail(ctx: BillingEmailContext): {
  subject: string;
  html: string;
  text: string;
} {
  const greeting = ctx.recipientName ? `Hi ${ctx.recipientName},` : 'Hi,';
  const org = escapeHtml(ctx.organizationName);
  const plan = escapeHtml(ctx.planDisplayName);
  const periodEnd = formatEmailDate(ctx.periodEnd);

  const bodyHtml = `
    <p style="margin:0 0 12px 0;">${escapeHtml(greeting)}</p>
    <p style="margin:0 0 12px 0;">The free trial for <strong>${org}</strong> has ended. Your account is now on the <strong>${plan}</strong> plan.</p>
    <p style="margin:0;">Your current billing period runs through <strong>${escapeHtml(periodEnd)}</strong>. You can review invoices and manage seats from your organization dashboard.</p>
  `;

  const text = `${greeting}

The free trial for ${ctx.organizationName} has ended. Your account is now on the ${ctx.planDisplayName} plan.

Your current billing period runs through ${periodEnd}.

Manage billing: ${ctx.dashboardUrl}

— The Conviction team`;

  return {
    subject: SUBJECT,
    html: renderTransactionalEmailLayout({
      preheader: `Your free trial for ${ctx.organizationName} has ended.`,
      title: 'Free trial ended',
      bodyHtml,
      ctaLabel: 'Manage billing →',
      ctaUrl: ctx.dashboardUrl,
    }),
    text,
  };
}
