export type BillingEmailContext = {
  organizationName: string;
  planDisplayName: string;
  billingInterval: string | null;
  periodEnd: string | null;
  seatQuantity: number;
  dashboardUrl: string;
  recipientName: string | null;
  previousPlanDisplayName?: string | null;
  cancelAtPeriodEnd?: boolean;
};
