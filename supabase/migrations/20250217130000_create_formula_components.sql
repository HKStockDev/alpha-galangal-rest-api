create table if not exists public.formula_components (
  id uuid primary key default gen_random_uuid(),
  parent_formula_id uuid references public.formulas(id),
  child_formula_id uuid references public.formulas(id),
  weight numeric
);
