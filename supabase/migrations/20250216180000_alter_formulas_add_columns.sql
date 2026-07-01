alter table public.formulas
  add column if not exists category text,
  add column if not exists formula_level text,
  add column if not exists execution_type text,
  add column if not exists parent_formula_id uuid references public.formulas(id),
  add column if not exists version integer default 1,
  add column if not exists is_active boolean default true;
