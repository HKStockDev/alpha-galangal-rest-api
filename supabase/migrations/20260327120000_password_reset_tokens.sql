create table if not exists public.password_reset_tokens (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  email text not null,
  token_hash text not null unique,
  expires_at timestamptz not null,
  consumed_at timestamptz null,
  request_ip text null,
  created_at timestamptz not null default now()
);

create index if not exists idx_password_reset_tokens_email
  on public.password_reset_tokens (email);

create index if not exists idx_password_reset_tokens_expires_at
  on public.password_reset_tokens (expires_at);

create index if not exists idx_password_reset_tokens_user_id
  on public.password_reset_tokens (user_id);

alter table public.password_reset_tokens enable row level security;

revoke all on table public.password_reset_tokens from anon, authenticated;
