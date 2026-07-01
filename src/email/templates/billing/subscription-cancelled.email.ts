import { escapeHtml } from '../marketing/contact/escape-html';
import { formatEmailDate } from '../shared/format-date';
import { renderTransactionalEmailLayout } from '../shared/transactional-layout';
import type { BillingEmailContext } from './types';

const SUBJECT = 'Your Conviction subscription has been cancelled';

export function renderSubscriptionCancelledEmail(ctx: BillingEmailContext): {
  subject: string;
  html: string;
  text: string;
} {
  const greeting = ctx.recipientName ? `Hi ${ctx.recipientName},` : 'Hi,';
  const org = escapeHtml(ctx.organizationName);
  const plan = escapeHtml(ctx.planDisplayName);
  const periodEnd = formatEmailDate(ctx.periodEnd);

  const scheduleNote = ctx.cancelAtPeriodEnd
    ? `<p style="margin:12px 0 0 0;">Your <strong>${plan}</strong> access for <strong>${org}</strong> will remain available until <strong>${escapeHtml(periodEnd)}</strong>, then your subscription will end.</p>`
    : `<p style="margin:12px 0 0 0;">Your <strong>${plan}</strong> subscription for <strong>${org}</strong> has been cancelled.</p>`;

  const textSchedule = ctx.cancelAtPeriodEnd
    ? `Your ${ctx.planDisplayName} access for ${ctx.organizationName} will remain available until ${periodEnd}, then your subscription will end.`
    : `Your ${ctx.planDisplayName} subscription for ${ctx.organizationName} has been cancelled.`;

  const bodyHtml = `
    <p style="margin:0 0 12px 0;">${escapeHtml(greeting)}</p>
    ${scheduleNote}
    <p style="margin:12px 0 0 0;">If this was unexpected, you can review billing details or reactivate from your dashboard.</p>
  `;

  const text = `${greeting}

${textSchedule}

If this was unexpected, review billing from your dashboard: ${ctx.dashboardUrl}

— The Conviction team`;

  return {
    subject: SUBJECT,
    html: renderTransactionalEmailLayout({
      preheader: ctx.cancelAtPeriodEnd
        ? `Your ${ctx.planDisplayName} subscription for ${ctx.organizationName} is scheduled to end on ${periodEnd}.`
        : `Your ${ctx.planDisplayName} subscription for ${ctx.organizationName} has been cancelled.`,
      title: 'Subscription cancelled',
      bodyHtml,
      ctaLabel: 'View billing →',
      ctaUrl: ctx.dashboardUrl,
    }),
    text,
  };
}
