import { escapeHtml } from '../marketing/contact/escape-html';
import { formatEmailDate } from '../shared/format-date';
import { renderTransactionalEmailLayout } from '../shared/transactional-layout';
import type { BillingEmailContext } from './types';

const SUBJECT = 'Your Precision plan has been upgraded';

export function renderSubscriptionUpgradedEmail(ctx: BillingEmailContext): {
  subject: string;
  html: string;
  text: string;
} {
  const greeting = ctx.recipientName ? `Hi ${ctx.recipientName},` : 'Hi,';
  const org = escapeHtml(ctx.organizationName);
  const plan = escapeHtml(ctx.planDisplayName);
  const previous = ctx.previousPlanDisplayName
    ? escapeHtml(ctx.previousPlanDisplayName)
    : 'your previous plan';
  const periodEnd = formatEmailDate(ctx.periodEnd);

  const bodyHtml = `
    <p style="margin:0 0 12px 0;">${escapeHtml(greeting)}</p>
    <p style="margin:0 0 12px 0;"><strong>${org}</strong> has been upgraded from <strong>${previous}</strong> to <strong>${plan}</strong>.</p>
    <p style="margin:0;">Your updated plan is active through <strong>${escapeHtml(periodEnd)}</strong>. Manage billing and seats from your organization dashboard.</p>
  `;

  const text = `${greeting}

${ctx.organizationName} has been upgraded from ${ctx.previousPlanDisplayName ?? 'your previous plan'} to ${ctx.planDisplayName}.

Your updated plan is active through ${periodEnd}.

Manage billing: ${ctx.dashboardUrl}

— The Precision team`;

  return {
    subject: SUBJECT,
    html: renderTransactionalEmailLayout({
      preheader: `${ctx.organizationName} is now on the ${ctx.planDisplayName} plan.`,
      title: 'Plan upgraded',
      bodyHtml,
      ctaLabel: 'Manage billing →',
      ctaUrl: ctx.dashboardUrl,
    }),
    text,
  };
}
