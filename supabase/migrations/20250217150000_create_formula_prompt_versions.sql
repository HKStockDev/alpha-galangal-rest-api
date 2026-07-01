create table if not exists public.formula_prompt_versions (
  id uuid primary key default gen_random_uuid(),
  formula_id uuid not null references public.formulas(id) on delete cascade,

  version integer not null,
  status text not null default 'draft',

  system_prompt text not null,
  user_prompt_template text not null,

  output_schema jsonb,
  notes text,

  model_name text,
  temperature numeric,
  top_p numeric,
  max_output_tokens integer,

  created_at timestamptz not null default now(),

  unique (formula_id, version)
);

create index if not exists idx_prompt_versions_formula on public.formula_prompt_versions(formula_id);
create index if not exists idx_prompt_versions_status on public.formula_prompt_versions(status);

alter table public.formulas
  add column if not exists active_prompt_version_id uuid references public.formula_prompt_versions(id);
