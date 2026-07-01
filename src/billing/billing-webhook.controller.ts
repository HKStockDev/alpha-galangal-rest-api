import {
  BadRequestException,
  Controller,
  Headers,
  HttpCode,
  Post,
  RawBodyRequest,
  Req,
} from '@nestjs/common';
import { Request } from 'express';
import { BillingWebhookService } from './billing-webhook.service';

@Controller('billing')
export class BillingWebhookController {
  constructor(private readonly billingWebhookService: BillingWebhookService) {}

  @Post('webhook')
  @HttpCode(200)
  async handleWebhook(
    @Req() req: RawBodyRequest<Request>,
    @Headers('stripe-signature') signature: string | undefined,
  ) {
    const rawBody = req.rawBody;
    if (!rawBody || !Buffer.isBuffer(rawBody)) {
      throw new BadRequestException('Stripe webhook requires raw request body');
    }
    return this.billingWebhookService.handleWebhook(rawBody, signature);
  }
}
