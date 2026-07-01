export type EntitlementBlockReason =
  | 'disabled_by_policy'
  | 'blocked_by_plan'
  | 'hard_block'
  | 'missing_scope';

export type EntitlementCheckResult =
  | { allowed: true; needsConfirmation: boolean }
  | {
      allowed: false;
      reason: EntitlementBlockReason;
      capabilityKey: string;
      message: string;
      planKey?: string;
    };
