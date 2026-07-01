import { escapeHtml } from '../marketing/contact/escape-html';
import { formatEmailDate } from '../shared/format-date';
import { renderTransactionalEmailLayout } from '../shared/transactional-layout';
import type { BillingEmailContext } from './types';

const SUBJECT = 'Your Conviction subscription is active';

export function renderSubscriptionPurchasedEmail(ctx: BillingEmailContext): {
  subject: string;
  html: string;
  text: string;
} {
  const greeting = ctx.recipientName ? `Hi ${ctx.recipientName},` : 'Hi,';
  const org = escapeHtml(ctx.organizationName);
  const plan = escapeHtml(ctx.planDisplayName);
  const periodEnd = formatEmailDate(ctx.periodEnd);
  const interval = ctx.billingInterval ? escapeHtml(ctx.billingInterval) : 'billing period';

  const bodyHtml = `
    <p style="margin:0 0 12px 0;">${escapeHtml(greeting)}</p>
    <p style="margin:0 0 12px 0;">Your subscription for <strong>${org}</strong> is now active on the <strong>${plan}</strong> plan.</p>
    <p style="margin:0;">Your current ${interval} runs through <strong>${escapeHtml(periodEnd)}</strong>. You can manage billing and seats from your organization dashboard.</p>
  `;

  const text = `${greeting}

Your subscription for ${ctx.organizationName} is now active on the ${ctx.planDisplayName} plan.

Your current billing period runs through ${periodEnd}.

Manage billing: ${ctx.dashboardUrl}

— The Conviction team`;

  return {
    subject: SUBJECT,
    html: renderTransactionalEmailLayout({
      preheader: `Your ${ctx.planDisplayName} subscription for ${ctx.organizationName} is active.`,
      title: 'Your subscription is active',
      bodyHtml,
      ctaLabel: 'Manage billing →',
      ctaUrl: ctx.dashboardUrl,
    }),
    text,
  };
}
