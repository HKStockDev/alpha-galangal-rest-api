import { Body, Controller, HttpCode, Post, UseGuards } from '@nestjs/common';
import { Throttle, ThrottlerGuard } from '@nestjs/throttler';
import { ContactFormSubmissionDto } from './dto/contact-form-submission.dto';
import { MarketingContactFormService } from './marketing-contact-form.service';

@Controller('marketing/contact')
export class MarketingContactController {
  constructor(private readonly contact: MarketingContactFormService) {}

  @Post()
  @HttpCode(201)
  @UseGuards(ThrottlerGuard)
  @Throttle({ contact: { limit: 5, ttl: 60000 } })
  submit(@Body() dto: ContactFormSubmissionDto): Promise<{ ok: true }> {
    return this.contact.submit(dto);
  }
}
