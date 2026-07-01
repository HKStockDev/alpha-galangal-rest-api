import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { DEFAULT_FRONTEND_BASE_URL } from '../config/app-urls';
import { EmailService } from '../email/email.service';
import { renderSubscriptionCancelledEmail } from '../email/templates/billing/subscription-cancelled.email';
import { renderSubscriptionPurchasedEmail } from '../email/templates/billing/subscription-purchased.email';
import { renderSubscriptionUpgradedEmail } from '../email/templates/billing/subscription-upgraded.email';
import { renderTrialEndedEmail } from '../email/templates/billing/trial-ended.email';
import type { BillingEmailContext } from '../email/templates/billing/types';
import { maskEmailForLogs } from '../email/email-log.util';
import {
  BillingNotificationTransition,
  billingNotificationDedupeKey,
} from './billing-email-transitions';
import { SubscriptionPlanRow } from './billing.types';

export type OrgAdminRecipient = {
  email: string;
  fullName: string | null;
};

export type BillingEmailNotificationParams = {
  organizationId: string;
  stripeEventId: string;
  transition: BillingNotificationTransition;
  plan: SubscriptionPlanRow;
  previousPlan?: SubscriptionPlanRow | null;
  periodEnd: string | null;
  seatQuantity: number;
  cancelAtPeriodEnd?: boolean;
};

@Injectable()
export class BillingEmailService {
  private readonly logger = new Logger(BillingEmailService.name);
  private readonly adminClient: SupabaseClient | null;
  private readonly frontendUrl: string;
  private readonly fromEmail: string;

  constructor(
    private readonly config: ConfigService,
    private readonly emailService: EmailService,
  ) {
    const url = this.config.get<string>('supabase.url');
    const serviceRoleKey = this.config.get<string>('supabase.serviceRoleKey');
    const anonKey = this.config.get<string>('supabase.anonKey');
    this.adminClient =
      url && (serviceRoleKey || anonKey)
        ? createClient(url, serviceRoleKey ?? anonKey!)
        : null;

    this.frontendUrl = (
      this.config.get<string>('invitations.frontendUrl') ?? DEFAULT_FRONTEND_BASE_URL
    ).replace(/\/$/, '');
    this.fromEmail =
      this.config.get<string>('invitations.fromEmail') ?? 'alex@withprecision.ai';
  }

  private getDb(): SupabaseClient | null {
    return this.adminClient;
  }

  private dashboardUrl(): string {
    return `${this.frontendUrl}/org/dashboard`;
  }

  async resolveOrgAdminRecipients(organizationId: string): Promise<OrgAdminRecipient[]> {
    const db = this.getDb();
    if (!db) {
      this.logger.warn('Database client not configured; cannot resolve org admin recipients');
      return [];
    }

    const { data, error } = await db
      .from('organization_memberships')
      .select('profiles!organization_memberships_user_id_fkey(email, full_name)')
      .eq('organization_id', organizationId)
      .eq('role', 'org_admin')
      .eq('status', 'active');

    if (error) {
      this.logger.error(`resolveOrgAdminRecipients failed: ${error.message}`);
      return [];
    }

    const recipients: OrgAdminRecipient[] = [];
    const seen = new Set<string>();

    for (const row of data ?? []) {
      const profile = row.profiles as { email?: string; full_name?: string | null } | null;
      const email = profile?.email?.trim();
      if (!email) {
        continue;
      }
      const key = email.toLowerCase();
      if (seen.has(key)) {
        continue;
      }
      seen.add(key);
      recipients.push({ email, fullName: profile?.full_name ?? null });
    }

    return recipients;
  }

  private async loadOrganizationName(organizationId: string): Promise<string> {
    const db = this.getDb();
    if (!db) {
      return 'your organization';
    }

    const { data } = await db
      .from('organizations')
      .select('name')
      .eq('id', organizationId)
      .maybeSingle();

    return (data?.name as string | undefined) ?? 'your organization';
  }

  private formatBillingInterval(interval: string | null | undefined): string | null {
    if (!interval) {
      return null;
    }
    const v = interval.trim().toLowerCase();
    if (v === 'month' || v === 'monthly') {
      return 'monthly billing period';
    }
    if (v === 'year' || v === 'yearly' || v === 'annual') {
      return 'annual billing period';
    }
    return `${interval} billing period`;
  }

  private buildContext(
    params: BillingEmailNotificationParams & { organizationName: string; recipient: OrgAdminRecipient },
  ): BillingEmailContext {
    return {
      organizationName: params.organizationName,
      planDisplayName: params.plan.display_name ?? 'your plan',
      billingInterval: this.formatBillingInterval(params.plan.billing_interval),
      periodEnd: params.periodEnd,
      seatQuantity: params.seatQuantity,
      dashboardUrl: this.dashboardUrl(),
      recipientName: params.recipient.fullName,
      previousPlanDisplayName: params.previousPlan?.display_name ?? null,
      cancelAtPeriodEnd: params.cancelAtPeriodEnd ?? false,
    };
  }

  private renderEmail(
    transition: BillingNotificationTransition,
    ctx: BillingEmailContext,
  ): { subject: string; html: string; text: string } {
    switch (transition) {
      case 'subscription_purchased':
        return renderSubscriptionPurchasedEmail(ctx);
      case 'subscription_cancelled':
        return renderSubscriptionCancelledEmail(ctx);
      case 'subscription_upgraded':
        return renderSubscriptionUpgradedEmail(ctx);
      case 'trial_ended':
        return renderTrialEndedEmail(ctx);
    }
  }

  private async tryRecordDedupe(params: {
    notificationType: string;
    dedupeKey: string;
    stripeEventId: string;
    recipientEmail: string;
  }): Promise<boolean> {
    const db = this.getDb();
    if (!db) {
      return true;
    }

    const { error } = await db.from('email_notification_log').insert({
      notification_type: params.notificationType,
      dedupe_key: params.dedupeKey,
      stripe_event_id: params.stripeEventId,
      recipient_email: params.recipientEmail,
    });

    if (!error) {
      return true;
    }

    if (error.code === '23505') {
      return false;
    }

    this.logger.error(`email_notification_log insert failed: ${error.message}`);
    return false;
  }

  private async sendToRecipient(params: {
    transition: BillingNotificationTransition;
    stripeEventId: string;
    recipient: OrgAdminRecipient;
    emailContent: { subject: string; html: string; text: string };
  }): Promise<void> {
    const dedupeKey = billingNotificationDedupeKey(
      params.transition,
      `${params.stripeEventId}:${params.recipient.email.toLowerCase()}`,
    );

    const shouldSend = await this.tryRecordDedupe({
      notificationType: params.transition,
      dedupeKey,
      stripeEventId: params.stripeEventId,
      recipientEmail: params.recipient.email,
    });

    if (!shouldSend) {
      return;
    }

    if (!this.emailService.isConfigured()) {
      this.logger.warn(
        `RESEND_API_KEY not set; skipping ${params.transition} email to ${maskEmailForLogs(params.recipient.email)}`,
      );
      return;
    }

    const result = await this.emailService.send({
      to: params.recipient.email,
      subject: params.emailContent.subject,
      html: params.emailContent.html,
      text: params.emailContent.text,
      from: this.fromEmail,
    });

    if (!result.success) {
      this.logger.warn(
        `${params.transition} email failed maskedEmail=${maskEmailForLogs(params.recipient.email)} reason=${result.error ?? 'unknown'}`,
      );
    }
  }

  async sendBillingNotification(params: BillingEmailNotificationParams): Promise<void> {
    try {
      const recipients = await this.resolveOrgAdminRecipients(params.organizationId);
      if (recipients.length === 0) {
        this.logger.warn(
          `No org admin recipients for organization ${params.organizationId}; skipping ${params.transition}`,
        );
        return;
      }

      const organizationName = await this.loadOrganizationName(params.organizationId);

      for (const recipient of recipients) {
        const ctx = this.buildContext({ ...params, organizationName, recipient });
        const emailContent = this.renderEmail(params.transition, ctx);
        await this.sendToRecipient({
          transition: params.transition,
          stripeEventId: params.stripeEventId,
          recipient,
          emailContent,
        });
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.error(
        `sendBillingNotification(${params.transition}) failed for org ${params.organizationId}: ${message}`,
      );
    }
  }
}
