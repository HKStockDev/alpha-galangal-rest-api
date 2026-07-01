begin;

-- =========================================================
-- content_categories
-- admin-controlled allowed category values for market_content.category
-- =========================================================

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create table if not exists public.content_categories (
  id uuid primary key default gen_random_uuid(),

  key text not null unique,
  label text not null,
  description text,

  is_active boolean not null default true,
  sort_order integer not null default 0,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint content_categories_key_not_blank
    check (btrim(key) <> ''),

  constraint content_categories_label_not_blank
    check (btrim(label) <> '')
);

comment on table public.content_categories is
'Admin-controlled allowed category values for market content classification.';

comment on column public.content_categories.key is
'Stable internal key such as regulatory, management, product, macro.';

comment on column public.content_categories.label is
'Human-readable label shown in the UI.';

comment on column public.content_categories.description is
'Optional admin guidance for when to use this category.';

comment on column public.content_categories.is_active is
'Whether this category is currently available for prompts and validation.';

comment on column public.content_categories.sort_order is
'Display order in admin and filter UIs.';

drop trigger if exists trg_content_categories_updated_at on public.content_categories;
create trigger trg_content_categories_updated_at
before update on public.content_categories
for each row
execute function public.set_updated_at();

create index if not exists idx_content_categories_is_active_sort
  on public.content_categories(is_active, sort_order, label);

create index if not exists idx_content_categories_key
  on public.content_categories(key);

-- ensure market_content has category column
alter table public.market_content
  add column if not exists category text;

comment on column public.market_content.category is
'Theme classification such as regulatory, management, product, macro, financial, etc.';

create index if not exists idx_market_content_category
  on public.market_content(category);

-- seed defaults
insert into public.content_categories (key, label, description, is_active, sort_order)
values
  ('financial', 'Financial', 'Financial results, balance sheet, profitability, capital allocation, or other core financial matters.', true, 10),
  ('regulatory', 'Regulatory', 'Regulatory reviews, compliance issues, exchange notices, government actions, or oversight matters.', true, 20),
  ('legal', 'Legal', 'Lawsuits, settlements, court rulings, legal claims, or litigation-related developments.', true, 30),
  ('management', 'Management', 'Leadership changes, executive actions, governance, board matters, or internal control topics.', true, 40),
  ('product', 'Product', 'Product launches, recalls, roadmap changes, technology releases, or product-specific developments.', true, 50),
  ('macro', 'Macro', 'Macro-economic releases, central bank actions, rates, inflation, or broad economy developments.', true, 60),
  ('industry', 'Industry', 'Industry-wide developments, competitor landscape shifts, supply-demand changes, or sector moves.', true, 70),
  ('capital_markets', 'Capital Markets', 'Equity raises, debt issuance, buybacks, offerings, listing matters, or financing events.', true, 80),
  ('earnings', 'Earnings', 'Earnings reports, pre-announcements, misses, beats, and earnings-specific commentary.', true, 90),
  ('guidance', 'Guidance', 'Forward guidance changes, outlook updates, revisions, or management forecasts.', true, 100),
  ('analyst', 'Analyst', 'Analyst notes, rating changes, target changes, or research commentary.', true, 110)
on conflict (key) do update
set
  label = excluded.label,
  description = excluded.description,
  is_active = excluded.is_active,
  sort_order = excluded.sort_order,
  updated_at = now();

commit;
