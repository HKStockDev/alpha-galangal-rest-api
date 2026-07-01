import { createHmac, randomBytes, timingSafeEqual } from 'crypto';
import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { SocialOauthPlatform } from './constants';

type StatePayload = {
  o: string;
  p: SocialOauthPlatform;
  e: number;
  n: string;
  /** PKCE code_verifier (X, TikTok). */
  cv?: string;
};

@Injectable()
export class SocialOauthStateService {
  constructor(private readonly config: ConfigService) {}

  private hmacSecret(): string {
    return (
      this.config.get<string>('social.oauthStateSecret')?.trim() ||
      this.config.get<string>('supabase.jwtSecret')?.trim() ||
      this.config.get<string>('supabase.serviceRoleKey')?.trim() ||
      ''
    );
  }

  createState(
    organizationId: string,
    platform: SocialOauthPlatform,
    codeVerifier?: string,
  ): string {
    const secret = this.hmacSecret();
    if (!secret) {
      throw new Error(
        'SOCIAL_OAUTH_STATE_SECRET, SUPABASE_JWT_SECRET, or SUPABASE_SERVICE_ROLE_KEY must be set to sign OAuth state.',
      );
    }
    const payload: StatePayload = {
      o: organizationId,
      p: platform,
      e: Date.now() + 10 * 60 * 1000,
      n: randomBytes(16).toString('hex'),
      ...(codeVerifier ? { cv: codeVerifier } : {}),
    };
    const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
    const sig = createHmac('sha256', secret).update(body).digest('base64url');
    return `${body}.${sig}`;
  }

  verifyAndConsume(
    state: string,
    platform: SocialOauthPlatform,
  ): { organizationId: string; codeVerifier?: string } {
    const secret = this.hmacSecret();
    if (!secret) {
      throw new UnauthorizedException('OAuth state signing is not configured.');
    }
    const dot = state.lastIndexOf('.');
    if (dot <= 0) {
      throw new UnauthorizedException('Invalid OAuth state.');
    }
    const body = state.slice(0, dot);
    const sig = state.slice(dot + 1);
    const expected = createHmac('sha256', secret).update(body).digest('base64url');
    const a = Buffer.from(sig);
    const b = Buffer.from(expected);
    if (a.length !== b.length || !timingSafeEqual(a, b)) {
      throw new UnauthorizedException('Invalid OAuth state signature.');
    }
    let payload: StatePayload;
    try {
      payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as StatePayload;
    } catch {
      throw new UnauthorizedException('Invalid OAuth state payload.');
    }
    if (payload.p !== platform) {
      throw new UnauthorizedException('OAuth state platform mismatch.');
    }
    if (typeof payload.e !== 'number' || Date.now() > payload.e) {
      throw new UnauthorizedException('OAuth state expired.');
    }
    if (typeof payload.o !== 'string' || !payload.o) {
      throw new UnauthorizedException('Invalid OAuth state organization.');
    }
    return {
      organizationId: payload.o,
      codeVerifier: typeof payload.cv === 'string' && payload.cv ? payload.cv : undefined,
    };
  }
}
