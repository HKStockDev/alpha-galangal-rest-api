drop index if exists public.idx_formulas_category;

do $$
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'formulas' and column_name = 'category'
  ) then
    alter table public.formulas drop column category;
  end if;
end $$;

create index if not exists idx_formulas_category_id on public.formulas(category_id);

update public.formulas f
set
  category_id = sc.id,
  formula_level = case
    when f.key = 'hedge_fund_quality_score' then 'MASTER_MODEL'
    else 'DOMAIN_COMPOSITE'
  end,
  execution_type = 'deterministic',
  version = coalesce(f.version, 1),
  is_active = coalesce(f.is_active, true)
from public.signal_categories sc
where sc.name = 'BUSINESS_QUALITY'
  and f.key in (
    'hedge_fund_performance',
    'hedge_fund_risk',
    'hedge_fund_precision',
    'hedge_fund_institutional_strength',
    'hedge_fund_positioning',
    'hedge_fund_quality_score'
  );

update public.formulas child
set parent_formula_id = parent.id
from public.formulas parent
where parent.key = 'hedge_fund_quality_score'
  and child.key in (
    'hedge_fund_performance',
    'hedge_fund_risk',
    'hedge_fund_precision',
    'hedge_fund_institutional_strength',
    'hedge_fund_positioning'
  );

update public.formulas
set
  formula_level = coalesce(formula_level, 'DOMAIN_COMPOSITE'),
  execution_type = coalesce(execution_type, 'deterministic'),
  version = coalesce(version, 1),
  is_active = coalesce(is_active, true)
where formula_level is null or execution_type is null;
