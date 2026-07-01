import { Injectable } from '@nestjs/common';
import { CreditsService } from '../credits/credits.service';
import { EntitlementCheckService } from '../entitlements/entitlement-check.service';
import { MUTATING_TOOL_KEY_SET } from './assistant.constants';

@Injectable()
export class AssistantToolPolicyService {
  constructor(
    private readonly entitlement: EntitlementCheckService,
    private readonly credits: CreditsService,
  ) {}

  isMutatingTool(toolKey: string): boolean {
    return MUTATING_TOOL_KEY_SET.has(toolKey);
  }

  async assertToolAllowed(params: {
    organizationId: string;
    capabilityKey: string;
    organizationClientId: string | null;
  }): Promise<{ needsConfirmation: boolean }> {
    const result = await this.entitlement.checkOrganizationCapability({
      organizationId: params.organizationId,
      capabilityKey: params.capabilityKey,
      organizationClientId: params.organizationClientId,
    });
    if (!result.allowed) {
      throw new Error(result.message);
    }
    return { needsConfirmation: result.needsConfirmation };
  }

  async consumeToolCredits(params: {
    organizationId: string;
    capabilityKey: string;
    referenceId: string;
  }): Promise<number | undefined> {
    const result = await this.credits.consume({
      organizationId: params.organizationId,
      capabilityKey: params.capabilityKey,
      referenceId: params.referenceId,
    });
    if ('remainingCredits' in result) {
      return result.remainingCredits;
    }
    return undefined;
  }
}
