create table if not exists public.factors (
  id uuid primary key default gen_random_uuid(),
  key text not null unique,
  name text not null,
  value_type text not null default 'number',
  description text,
  created_at timestamptz default now()
);
