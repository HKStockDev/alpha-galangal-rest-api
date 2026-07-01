create table if not exists public.entity_scores_current (
  entity_id uuid references public.entities(id) on delete cascade,
  formula_id uuid references public.formulas(id) on delete cascade,
  score double precision not null,
  rank integer,
  explain jsonb,
  updated_at timestamptz default now(),
  primary key (entity_id, formula_id)
);

create index if not exists idx_entity_scores_formula_score
  on public.entity_scores_current(formula_id, score desc);
