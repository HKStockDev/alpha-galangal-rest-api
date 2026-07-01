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
import { AuthSendEmailHookService } from './auth-send-email-hook.service';

@Controller('auth/hooks')
export class AuthSendEmailHookController {
  constructor(private readonly hookService: AuthSendEmailHookService) {}

  @Post('send-email')
  @HttpCode(200)
  async handleSendEmail(
    @Req() req: RawBodyRequest<Request>,
    @Headers() headers: Record<string, string | string[] | undefined>,
  ): Promise<Record<string, never>> {
    const rawBody = req.rawBody;
    if (!rawBody || !Buffer.isBuffer(rawBody)) {
      throw new BadRequestException('Send-email hook requires raw request body');
    }

    const normalizedHeaders: Record<string, string> = {};
    for (const [key, value] of Object.entries(headers)) {
      if (typeof value === 'string') {
        normalizedHeaders[key] = value;
      } else if (Array.isArray(value) && value[0]) {
        normalizedHeaders[key] = value[0];
      }
    }

    return this.hookService.handleSendEmailHook(rawBody.toString('utf8'), normalizedHeaders);
  }
}
