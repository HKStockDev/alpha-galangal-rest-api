import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { renderPasswordChangedEmail } from '../email/templates/auth/password-changed.email';
import { renderPasswordResetEmail } from '../email/templates/auth/password-reset.email';
import { renderSignupVerificationEmail } from '../email/templates/auth/signup-verification.email';

describe('auth email templates', () => {
  it('renders password reset with escaped URL', () => {
    const resetUrl = 'https://app.example.com/reset?token=<script>';
    const { subject, html, text } = renderPasswordResetEmail({
      resetUrl,
      expiresMinutes: 30,
    });

    assert.equal(subject, 'Reset your Conviction password');
    assert.match(html, /Reset your password/);
    assert.match(html, /&lt;script&gt;/);
    assert.match(text, /reset\?token=/);
    assert.doesNotMatch(html, /<script>/);
  });

  it('renders password changed confirmation', () => {
    const changedAt = new Date('2026-06-30T12:00:00.000Z');
    const { subject, html, text } = renderPasswordChangedEmail({
      changedAt,
      settingsUrl: 'https://app.example.com/org/dashboard/settings',
    });

    assert.equal(subject, 'Your Conviction password was changed');
    assert.match(html, /Password changed/);
    assert.match(html, /org\/dashboard\/settings/);
    assert.match(text, /password was changed/i);
  });

  it('renders signup verification with escaped URL', () => {
    const confirmUrl = 'https://abc.supabase.co/auth/v1/verify?token=<bad>';
    const { subject, html, text } = renderSignupVerificationEmail({ confirmUrl });

    assert.equal(subject, 'Verify your Conviction account');
    assert.match(html, /Verify your email/);
    assert.match(html, /&lt;bad&gt;/);
    assert.match(text, /Confirm your email address/);
    assert.doesNotMatch(html, /<bad>/);
  });
});
