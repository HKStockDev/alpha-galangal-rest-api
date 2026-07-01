create table if not exists public.entity_scores_history (
  id uuid primary key default gen_random_uuid(),
  entity_id uuid references public.entities(id),
  formula_id uuid references public.formulas(id),
  score numeric,
  computed_at timestamptz default now()
);

create index if not exists idx_entity_scores_history_entity on public.entity_scores_history(entity_id);
create index if not exists idx_entity_scores_history_formula on public.entity_scores_history(formula_id);
