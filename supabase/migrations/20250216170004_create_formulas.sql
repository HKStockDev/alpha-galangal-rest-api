create table if not exists public.formulas (
  id uuid primary key default gen_random_uuid(),
  key text not null unique,
  name text not null,
  output_type text not null default 'number',
  definition jsonb not null,
  updated_at timestamptz default now()
);
