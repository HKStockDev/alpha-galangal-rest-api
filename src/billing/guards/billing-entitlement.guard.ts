import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  HttpException,
  HttpStatus,
  Injectable,
} from '@nestjs/common';
import { Request } from 'express';
import { RequestUser } from '../../auth/decorators/current-user.decorator';
import { BillingService } from '../billing.service';

type RequestWithUser = Request & { user: RequestUser };

/**
 * CON-98: org routes that require webhook-synced subscription (trialing, active, past_due).
 * Platform admins bypass. Pair with OrgMemberGuard.
 */
@Injectable()
export class BillingEntitlementGuard implements CanActivate {
  constructor(private readonly billingService: BillingService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<RequestWithUser>();
    const user = request.user;
    if (!user) {
      throw new ForbiddenException('User not authenticated');
    }
    if (user.isPlatformAdmin) {
      return true;
    }

    const rawOrgId = request.params['organizationId'];
    const organizationId = Array.isArray(rawOrgId) ? rawOrgId[0] : rawOrgId;
    if (!organizationId) {
      throw new ForbiddenException('Organization ID required');
    }

    const status = await this.billingService.getOrganizationBillingStatus(organizationId);
    if (!status.is_entitled) {
      throw new HttpException(
        {
          statusCode: HttpStatus.PAYMENT_REQUIRED,
          message:
            'An active subscription or trial is required. Manage billing in organization settings.',
          error: 'Payment Required',
        },
        HttpStatus.PAYMENT_REQUIRED,
      );
    }

    return true;
  }
}
