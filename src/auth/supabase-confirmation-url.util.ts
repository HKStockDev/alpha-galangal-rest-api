export type SupabaseEmailActionType =
  | 'signup'
  | 'invite'
  | 'magiclink'
  | 'recovery'
  | 'email_change'
  | 'email'
  | 'reauthentication'
  | 'password_changed_notification'
  | 'email_changed_notification'
  | 'phone_changed_notification'
  | 'identity_linked_notification'
  | 'identity_unlinked_notification'
  | 'mfa_factor_enrolled_notification'
  | 'mfa_factor_unenrolled_notification';

export type SupabaseSendEmailHookEmailData = {
  token: string;
  token_hash: string;
  redirect_to: string;
  email_action_type: SupabaseEmailActionType;
  site_url: string;
  token_new?: string;
  token_hash_new?: string;
};

/** Builds the Supabase Auth verify URL used in transactional auth emails. */
export function buildSupabaseConfirmationUrl(
  supabaseUrl: string,
  emailData: Pick<
    SupabaseSendEmailHookEmailData,
    'token_hash' | 'email_action_type' | 'redirect_to'
  >,
): string {
  const base = `${supabaseUrl.replace(/\/+$/, '')}/auth/v1/verify`;
  const params = new URLSearchParams({
    token: emailData.token_hash,
    type: emailData.email_action_type,
    redirect_to: emailData.redirect_to,
  });
  return `${base}?${params.toString()}`;
}

/**
 * App-hosted confirm page — avoids email scanners consuming the Supabase verify URL.
 * User opens this link, then confirms via POST /auth/email-verification/confirm.
 */
export function buildAppHostedSignupConfirmationUrl(
  frontendBaseUrl: string,
  emailData: Pick<SupabaseSendEmailHookEmailData, 'token_hash' | 'email_action_type'>,
  email?: string,
): string {
  const base = frontendBaseUrl.replace(/\/+$/, '');
  const params = new URLSearchParams({
    token_hash: emailData.token_hash,
    type: emailData.email_action_type,
  });
  if (email?.trim()) {
    params.set('email', email.trim().toLowerCase());
  }
  return `${base}/auth/confirm?${params.toString()}`;
}

export const SUPABASE_AUTH_NOTIFICATION_EMAIL_TYPES = new Set<SupabaseEmailActionType>([
  'password_changed_notification',
  'email_changed_notification',
  'phone_changed_notification',
  'identity_linked_notification',
  'identity_unlinked_notification',
  'mfa_factor_enrolled_notification',
  'mfa_factor_unenrolled_notification',
]);
