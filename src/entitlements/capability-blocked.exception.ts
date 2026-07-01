import { HttpException, HttpStatus } from '@nestjs/common';
import type { EntitlementBlockReason } from './entitlement-check.types';

export class CapabilityBlockedException extends HttpException {
  constructor(params: {
    capabilityKey: string;
    reason: EntitlementBlockReason;
    message: string;
    planKey?: string;
    remainingCredits?: number;
    requiredCredits?: number;
  }) {
    super(
      {
        statusCode:
          params.reason === 'blocked_by_plan' || params.reason === 'hard_block'
            ? HttpStatus.FORBIDDEN
            : HttpStatus.FORBIDDEN,
        code: 'CAPABILITY_BLOCKED',
        capability_key: params.capabilityKey,
        reason: params.reason,
        plan_key: params.planKey ?? null,
        remaining_credits: params.remainingCredits ?? null,
        required_credits: params.requiredCredits ?? null,
        message: params.message,
        error: 'Forbidden',
      },
      HttpStatus.FORBIDDEN,
    );
  }
}
