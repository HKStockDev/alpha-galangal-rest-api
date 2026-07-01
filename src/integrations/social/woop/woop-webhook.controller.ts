import { Body, Controller, Headers, Logger, Post, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHmac, timingSafeEqual } from 'crypto';
import { createClient, SupabaseClient } from '@supabase/supabase-js';

@Controller('integrations/woop')
export class WoopWebhookController {
  private readonly logger = new Logger(WoopWebhookController.name);

  constructor(private readonly config: ConfigService) {}

  private db(): SupabaseClient | null {
    const url = this.config.get<string>('supabase.url');
    const serviceRoleKey = this.config.get<string>('supabase.serviceRoleKey');
    const anonKey = this.config.get<string>('supabase.anonKey');
    if (!url || !(serviceRoleKey || anonKey)) return null;
    return createClient(url, serviceRoleKey ?? anonKey!);
  }

  private verifySignature(rawBody: string, signatureHeader: string | undefined): boolean {
    const secretB64 = this.config.get<string>('woopSocial.webhookSigningSecret')?.trim();
    if (!secretB64 || !signatureHeader) return false;
    const match = signatureHeader.match(/t=(\d+),v1=([a-f0-9]+)/i);
    if (!match) return false;
    const [, timestamp, v1] = match;
    const secret = Buffer.from(secretB64, 'base64');
    const signed = `${timestamp}.${rawBody}`;
    const expected = createHmac('sha256', secret).update(signed).digest('hex');
    try {
      return timingSafeEqual(Buffer.from(v1, 'hex'), Buffer.from(expected, 'hex'));
    } catch {
      return false;
    }
  }

  @Post('webhooks')
  async handleWebhook(
    @Body() body: Record<string, unknown>,
    @Headers('x-woop-signature') signature: string | undefined,
  ) {
    const rawBody = JSON.stringify(body);
    if (!this.verifySignature(rawBody, signature)) {
      this.logger.warn('Woop webhook signature verification failed');
      return { ok: false };
    }

    const eventType = String(body.type ?? body.eventType ?? '');
    const data = (body.data ?? body.payload ?? body) as Record<string, unknown>;
    const socialAccountPostId = String(
      data.socialAccountPostId ?? data.social_account_post_id ?? '',
    );
    const woopPostId = String(data.postId ?? data.post_id ?? '');

    const db = this.db();
    if (!db) {
      throw new ServiceUnavailableException('Database not configured for webhooks.');
    }

    let q = db.from('social_posts').select('id').limit(1);
    if (woopPostId) {
      q = q.contains('prompt_params', { woop_post_id: woopPostId });
    }
    const { data: posts } = await q;
    const postId = (posts as Array<{ id: string }> | null)?.[0]?.id;
    if (!postId) {
      this.logger.log(`Woop webhook ${eventType}: no matching local post (${woopPostId})`);
      return { ok: true, matched: false };
    }

    if (eventType.includes('published')) {
      await db
        .from('social_posts')
        .update({
          status: 'published',
          published_at: new Date().toISOString(),
          last_error_message: null,
          external_post_id: socialAccountPostId || null,
        })
        .eq('id', postId);
    } else if (eventType.includes('failed')) {
      await db
        .from('social_posts')
        .update({
          status: 'failed',
          last_error_message: String(data.error ?? data.message ?? 'Woop delivery failed'),
        })
        .eq('id', postId);
    }

    return { ok: true, matched: true, post_id: postId };
  }
}
