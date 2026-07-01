-- =========================================
-- 1) FACTORS: add metadata to route storage
-- =========================================
alter table public.factors
add column if not exists data_grain text,
add column if not exists period_supported text,
add column if not exists statement_type text;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'chk_factors_data_grain') then
    alter table public.factors add constraint chk_factors_data_grain
    check (data_grain in ('snapshot','time_series'));
  end if;
end $$;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'chk_factors_period_supported') then
    alter table public.factors add constraint chk_factors_period_supported
    check (period_supported in ('quarterly','annual','both','none'));
  end if;
end $$;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'chk_factors_statement_type') then
    alter table public.factors add constraint chk_factors_statement_type
    check (statement_type in (
      'income_statement',
      'balance_sheet',
      'cash_flow_statement',
      'financial_ratio',
      'market_data',
      'custom'
    ));
  end if;
end $$;

create unique index if not exists uq_factors_key on public.factors(key);

-- =========================================
-- 2) ENTITY_FACTOR_VALUES: treat as CURRENT snapshot
-- =========================================

create unique index if not exists uq_entity_factor_values_entity_factor
on public.entity_factor_values(entity_id, factor_id);

alter table public.entity_factor_values
add column if not exists source text,
add column if not exists ingested_at timestamptz default now();

-- =========================================
-- 3) ENTITY_FACTOR_VALUES_TS: time-series (quarterly/annual)
-- =========================================
create table if not exists public.entity_factor_values_ts (
  id uuid primary key default gen_random_uuid(),

  entity_id uuid not null references public.entities(id) on delete cascade,
  factor_id uuid not null references public.factors(id) on delete cascade,

  value_num float8,
  value_text text,
  unit text,
  currency text,

  timeframe text not null,
  fiscal_year int,
  fiscal_period text,

  start_date date,
  end_date date not null,
  period_of_report_date date,
  filing_date date,

  source text not null,
  ingested_at timestamptz not null default now()
);

create index if not exists idx_evts_entity_factor_enddate
on public.entity_factor_values_ts(entity_id, factor_id, end_date desc);

create index if not exists idx_evts_entity_timeframe_fy_fp
on public.entity_factor_values_ts(entity_id, timeframe, fiscal_year, fiscal_period);

create unique index if not exists uq_evts_dedup
on public.entity_factor_values_ts(
  entity_id,
  factor_id,
  timeframe,
  coalesce(fiscal_year, -1),
  coalesce(fiscal_period, 'NA'),
  end_date,
  source
);

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'chk_evts_timeframe') then
    alter table public.entity_factor_values_ts add constraint chk_evts_timeframe
    check (timeframe in ('quarterly','annual','ttm'));
  end if;
end $$;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'chk_evts_fiscal_period') then
    alter table public.entity_factor_values_ts add constraint chk_evts_fiscal_period
    check (fiscal_period is null or fiscal_period in ('Q1','Q2','Q3','Q4'));
  end if;
end $$;
