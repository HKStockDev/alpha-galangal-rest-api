create extension if not exists pgcrypto;

create table if not exists public.taxonomies (
  taxonomy_id uuid primary key default gen_random_uuid(),
  name text not null unique,
  version integer not null default 1,
  description text,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_taxonomies_is_active
  on public.taxonomies (is_active);

create table if not exists public.taxonomy_nodes (
  node_id uuid primary key default gen_random_uuid(),

  taxonomy_id uuid not null
    references public.taxonomies(taxonomy_id)
    on delete cascade,

  level text not null
    check (level in ('sector', 'industry_group', 'industry', 'sub_industry')),

  name text not null,
  code text,

  parent_node_id uuid
    references public.taxonomy_nodes(node_id)
    on delete restrict,

  sort_order integer,
  is_active boolean not null default true,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint uq_taxonomy_nodes_taxonomy_parent_name
    unique (taxonomy_id, parent_node_id, name)
);

create index if not exists idx_taxonomy_nodes_taxonomy
  on public.taxonomy_nodes (taxonomy_id);

create index if not exists idx_taxonomy_nodes_parent
  on public.taxonomy_nodes (parent_node_id);

create index if not exists idx_taxonomy_nodes_level
  on public.taxonomy_nodes (taxonomy_id, level);

create index if not exists idx_taxonomy_nodes_is_active
  on public.taxonomy_nodes (taxonomy_id, is_active);

create table if not exists public.sic_to_taxonomy_map (
  sic_map_id uuid primary key default gen_random_uuid(),

  taxonomy_id uuid not null
    references public.taxonomies(taxonomy_id)
    on delete cascade,

  sic_code integer not null
    check (sic_code between 0 and 9999),

  sic_description_pattern text,

  sub_industry_node_id uuid not null
    references public.taxonomy_nodes(node_id)
    on delete restrict,

  confidence numeric(4,3) not null default 0.800
    check (confidence >= 0 and confidence <= 1),

  map_version integer not null default 1,
  is_active boolean not null default true,

  notes text,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint uq_sic_to_taxonomy_map_rule
    unique (taxonomy_id, sic_code, sic_description_pattern, sub_industry_node_id, map_version)
);

create index if not exists idx_sic_map_lookup
  on public.sic_to_taxonomy_map (taxonomy_id, sic_code, is_active);

create index if not exists idx_sic_map_leaf
  on public.sic_to_taxonomy_map (sub_industry_node_id);

create index if not exists idx_sic_map_version
  on public.sic_to_taxonomy_map (taxonomy_id, map_version);

create or replace function public.set_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

drop trigger if exists trg_taxonomies_updated_at on public.taxonomies;
create trigger trg_taxonomies_updated_at
  before update on public.taxonomies
  for each row execute procedure public.set_updated_at();

drop trigger if exists trg_taxonomy_nodes_updated_at on public.taxonomy_nodes;
create trigger trg_taxonomy_nodes_updated_at
  before update on public.taxonomy_nodes
  for each row execute procedure public.set_updated_at();

drop trigger if exists trg_sic_to_taxonomy_map_updated_at on public.sic_to_taxonomy_map;
create trigger trg_sic_to_taxonomy_map_updated_at
  before update on public.sic_to_taxonomy_map
  for each row execute procedure public.set_updated_at();
