import { Module } from '@nestjs/common';
import { MarketingContactController } from './marketing-contact.controller';
import { MarketingContactFormService } from './marketing-contact-form.service';

@Module({
  controllers: [MarketingContactController],
  providers: [MarketingContactFormService],
})
export class MarketingModule {}
