import { HttpException, HttpStatus } from '@nestjs/common';

export class InsufficientCreditsException extends HttpException {
  constructor(params: { requiredCredits: number; remainingCredits: number; capabilityKey: string }) {
    super(
      {
        statusCode: HttpStatus.PAYMENT_REQUIRED,
        code: 'CAPABILITY_BLOCKED',
        capability_key: params.capabilityKey,
        reason: 'insufficient_credits',
        required_credits: params.requiredCredits,
        remaining_credits: params.remainingCredits,
        message: 'Insufficient credits. Purchase a credit pack to continue.',
        error: 'Payment Required',
      },
      HttpStatus.PAYMENT_REQUIRED,
    );
  }
}

export class CreditCostDisabledException extends HttpException {
  constructor(capabilityKey: string) {
    super(
      {
        statusCode: HttpStatus.FORBIDDEN,
        code: 'CAPABILITY_BLOCKED',
        capability_key: capabilityKey,
        reason: 'disabled_by_policy',
        message: 'This capability is not enabled for credit consumption.',
        error: 'Forbidden',
      },
      HttpStatus.FORBIDDEN,
    );
  }
}
