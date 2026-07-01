import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

export const SUPABASE_CLIENT = 'SUPABASE_CLIENT';

@Injectable()
export class SupabaseClientProvider {
  private client: SupabaseClient;

  constructor(private config: ConfigService) {
    const url = this.config.getOrThrow<string>('supabase.url');
    const anonKey = this.config.getOrThrow<string>('supabase.anonKey');
    this.client = createClient(url, anonKey);
  }

  getClient(): SupabaseClient {
    return this.client;
  }
}
