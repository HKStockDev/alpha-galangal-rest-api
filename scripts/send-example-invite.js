/**
 * One-off: create an invitation for anpolchert@gmail.com and optionally send email.
 * Usage: node scripts/send-example-invite.js
 */
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../.env.development') });
require('dotenv').config({ path: path.join(__dirname, '../.env') });

const { createClient } = require('@supabase/supabase-js');
const { Resend } = require('resend');
const crypto = require('crypto');

const EMAIL = 'anpolchert@gmail.com';
const ROLE = 'org_member';
const FRONTEND_URL = (process.env.FRONTEND_URL || process.env.INVITE_BASE_URL || 'http://app.localhost:3000').replace(/\/$/, '');
const FROM_EMAIL = process.env.INVITE_FROM_EMAIL || 'alex@withprecision.ai';

async function main() {
  const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY
  );

  const { data: org } = await supabase
    .from('organizations')
    .select('id, name')
    .eq('slug', 'default-organization')
    .single();
  if (!org) {
    console.error('Default organization not found');
    process.exit(1);
  }

  const { data: inviter } = await supabase
    .from('organization_memberships')
    .select('user_id')
    .eq('organization_id', org.id)
    .eq('role', 'org_admin')
    .eq('status', 'active')
    .limit(1)
    .single();
  const invitedBy = inviter?.user_id ?? null;

  await supabase
    .from('organization_invitations')
    .update({ status: 'revoked' })
    .eq('organization_id', org.id)
    .ilike('email', EMAIL)
    .eq('status', 'pending');

  const token = crypto.randomBytes(32).toString('hex');
  const expiresAt = new Date();
  expiresAt.setDate(expiresAt.getDate() + 7);

  const { data: inv, error } = await supabase
    .from('organization_invitations')
    .insert({
      organization_id: org.id,
      email: EMAIL,
      role: ROLE,
      status: 'pending',
      token,
      invited_by_user_id: invitedBy,
      expires_at: expiresAt.toISOString(),
    })
    .select('id, email, role, status, token, expires_at')
    .single();

  if (error) {
    console.error('Insert failed:', error.message);
    process.exit(1);
  }

  const inviteUrl = `${FRONTEND_URL}/invite/${token}`;
  console.log('Invitation created:');
  console.log('  id:', inv.id);
  console.log('  email:', inv.email);
  console.log('  role:', inv.role);
  console.log('  invite_url:', inviteUrl);

  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    console.log('\nRESEND_API_KEY not set – email not sent. Add it to .env.development to send emails.');
    return;
  }

  const resend = new Resend(apiKey);
  const { data: emailRes, error: emailErr } = await resend.emails.send({
    from: FROM_EMAIL,
    to: EMAIL,
    subject: `Invitation to join ${org.name}`,
    html: `
      <p>You've been invited to join <strong>${org.name}</strong> as <strong>${ROLE}</strong>.</p>
      <p>This invitation expires on ${expiresAt.toLocaleDateString()}.</p>
      <p><a href="${inviteUrl}" style="display:inline-block;padding:10px 20px;background:#4f46e5;color:white;text-decoration:none;border-radius:6px;">Accept invitation</a></p>
      <p>Or copy this link: ${inviteUrl}</p>
    `,
  });

  if (emailErr) {
    console.error('Email send failed:', emailErr.message);
    process.exit(1);
  }
  console.log('\nEmail sent to', EMAIL, '(id:', emailRes?.id, ')');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
