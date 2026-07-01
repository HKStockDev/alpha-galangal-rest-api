create table if not exists public.entities (
  id uuid primary key default gen_random_uuid(),
  entity_type text not null,
  key text not null unique,
  name text,
  created_at timestamptz default now()
);

create index if not exists idx_entities_type on public.entities(entity_type);
