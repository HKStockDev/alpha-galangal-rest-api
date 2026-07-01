create table if not exists public.entity_factor_values (
  entity_id uuid references public.entities(id) on delete cascade,
  factor_id uuid references public.factors(id) on delete cascade,
  value_num double precision,
  value_text text,
  updated_at timestamptz default now(),
  primary key (entity_id, factor_id)
);

create index if not exists idx_entity_factor_values_factor on public.entity_factor_values(factor_id);
create index if not exists idx_entity_factor_values_entity on public.entity_factor_values(entity_id);
