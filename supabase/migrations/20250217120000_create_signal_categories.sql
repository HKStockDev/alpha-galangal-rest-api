create table if not exists public.signal_categories (
  id uuid primary key default gen_random_uuid(),
  name text unique not null,
  description text
);

insert into public.signal_categories (name) values
('BUSINESS_QUALITY'),
('MISPRICING'),
('CAPITAL_FLOWS'),
('POSITIONING_PRESSURE'),
('NARRATIVE_SENTIMENT'),
('MACRO_REGIME'),
('STRUCTURAL_RISK'),
('INTELLIGENCE_SYNTHESIS')
on conflict (name) do nothing;

alter table public.formulas
  add column if not exists category_id uuid references public.signal_categories(id);
