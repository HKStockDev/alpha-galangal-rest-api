import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

@Injectable()
export class MassiveService {
  private readonly logger = new Logger(MassiveService.name);

  constructor(private config: ConfigService) {}

  private getApiKey(): string | undefined {
    return (
      this.config.get<string>('massive.apiKey') ??
      this.config.get<string>('MASSIVE_API_KEY') ??
      process.env.MASSIVE_API_KEY
    );
  }

  private getBaseUrl(): string {
    return this.config.get<string>('massive.baseUrl') ?? process.env.MASSIVE_API_BASE_URL ?? 'https://api.polygon.io';
  }

  getApiKeyPublic(): string | undefined {
    return this.getApiKey();
  }

  getBaseUrlPublic(): string {
    return this.getBaseUrl();
  }
}
