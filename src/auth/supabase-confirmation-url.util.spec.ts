import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  buildAppHostedSignupConfirmationUrl,
  buildSupabaseConfirmationUrl,
} from './supabase-confirmation-url.util';

describe('buildSupabaseConfirmationUrl', () => {
  it('builds verify URL with token hash, action type, and redirect', () => {
    const url = buildSupabaseConfirmationUrl('https://abc.supabase.co/', {
      token_hash: 'hash123',
      email_action_type: 'signup',
      redirect_to: 'https://app.example.com/auth/callback?email=user%40example.com',
    });

    assert.equal(
      url,
      'https://abc.supabase.co/auth/v1/verify?token=hash123&type=signup&redirect_to=https%3A%2F%2Fapp.example.com%2Fauth%2Fcallback%3Femail%3Duser%2540example.com',
    );
  });
});

describe('buildAppHostedSignupConfirmationUrl', () => {
  it('builds app confirm page URL with token hash and email', () => {
    const url = buildAppHostedSignupConfirmationUrl(
      'https://app.example.com',
      { token_hash: 'hash123', email_action_type: 'signup' },
      'user@example.com',
    );

    assert.equal(
      url,
      'https://app.example.com/auth/confirm?token_hash=hash123&type=signup&email=user%40example.com',
    );
  });
});
