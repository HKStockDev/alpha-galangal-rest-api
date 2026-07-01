import { Global, Module } from '@nestjs/common';
import { SupabaseClientProvider } from './supabase.provider';

@Global()
@Module({
  providers: [SupabaseClientProvider],
  exports: [SupabaseClientProvider],
})
export class SupabaseModule {}
