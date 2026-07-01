-- ============================================================
-- MULTI-TENANT FOUNDATION MIGRATION
-- For: organizations, profiles, memberships, tenant-scoped
--      factors, formulas, prompts, prompt_versions, tags,
--      signal_categories
-- ============================================================

begin;

-- ============================================================
-- 1) HELPER UPDATED_AT FUNCTION
-- ============================================================

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- ============================================================
-- 2) PROFILES
-- ============================================================

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text not null unique,
  full_name text null,
  status text not null default 'active' check (status in ('active', 'invited', 'suspended')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  last_login_at timestamptz null
);

drop trigger if exists trg_profiles_set_updated_at on public.profiles;
create trigger trg_profiles_set_updated_at
before update on public.profiles
for each row
execute function public.set_updated_at();

-- ============================================================
-- 3) ORGANIZATIONS
-- ============================================================

create table if not exists public.organizations (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  slug text not null unique,
  organization_type text not null check (
    organization_type in ('ria', 'research_firm', 'hedge_fund', 'family_office', 'asset_manager')
  ),
  status text not null default 'active' check (
    status in ('active', 'trial', 'suspended')
  ),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by_user_id uuid null references public.profiles(id) on delete set null,
  settings_json jsonb not null default '{}'::jsonb
);

drop trigger if exists trg_organizations_set_updated_at on public.organizations;
create trigger trg_organizations_set_updated_at
before update on public.organizations
for each row
execute function public.set_updated_at();

-- ============================================================
-- 4) ORGANIZATION MEMBERSHIPS
-- ============================================================

create table if not exists public.organization_memberships (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  role text not null check (role in ('org_admin', 'analyst', 'viewer')),
  status text not null default 'active' check (status in ('active', 'invited', 'disabled')),
  invited_by_user_id uuid null references public.profiles(id) on delete set null,
  joined_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, user_id)
);

drop trigger if exists trg_organization_memberships_set_updated_at on public.organization_memberships;
create trigger trg_organization_memberships_set_updated_at
before update on public.organization_memberships
for each row
execute function public.set_updated_at();

create index if not exists idx_org_memberships_org_user
  on public.organization_memberships (organization_id, user_id);

create index if not exists idx_org_memberships_user
  on public.organization_memberships (user_id);

-- ============================================================
-- 5) ADD TENANT / OWNERSHIP COLUMNS TO EXISTING TABLES
-- ============================================================

-- -------- factors --------
alter table public.factors
  add column if not exists organization_id uuid,
  add column if not exists created_by_user_id uuid null,
  add column if not exists updated_by_user_id uuid null,
  add column if not exists visibility text not null default 'organization';

alter table public.factors
  drop constraint if exists factors_visibility_check;

alter table public.factors
  add constraint factors_visibility_check
  check (visibility in ('organization', 'private'));

alter table public.factors
  drop constraint if exists factors_organization_id_fkey,
  add constraint factors_organization_id_fkey
    foreign key (organization_id) references public.organizations(id) on delete cascade;

alter table public.factors
  drop constraint if exists factors_created_by_user_id_fkey,
  add constraint factors_created_by_user_id_fkey
    foreign key (created_by_user_id) references public.profiles(id) on delete set null;

alter table public.factors
  drop constraint if exists factors_updated_by_user_id_fkey,
  add constraint factors_updated_by_user_id_fkey
    foreign key (updated_by_user_id) references public.profiles(id) on delete set null;

create index if not exists idx_factors_organization_id
  on public.factors (organization_id);

create index if not exists idx_factors_organization_name
  on public.factors (organization_id, name);

-- -------- formulas --------
alter table public.formulas
  add column if not exists organization_id uuid,
  add column if not exists created_by_user_id uuid null,
  add column if not exists updated_by_user_id uuid null,
  add column if not exists visibility text not null default 'organization';

alter table public.formulas
  drop constraint if exists formulas_visibility_check;

alter table public.formulas
  add constraint formulas_visibility_check
  check (visibility in ('organization', 'private'));

alter table public.formulas
  drop constraint if exists formulas_organization_id_fkey,
  add constraint formulas_organization_id_fkey
    foreign key (organization_id) references public.organizations(id) on delete cascade;

alter table public.formulas
  drop constraint if exists formulas_created_by_user_id_fkey,
  add constraint formulas_created_by_user_id_fkey
    foreign key (created_by_user_id) references public.profiles(id) on delete set null;

alter table public.formulas
  drop constraint if exists formulas_updated_by_user_id_fkey,
  add constraint formulas_updated_by_user_id_fkey
    foreign key (updated_by_user_id) references public.profiles(id) on delete set null;

create index if not exists idx_formulas_organization_id
  on public.formulas (organization_id);

create index if not exists idx_formulas_organization_name
  on public.formulas (organization_id, name);

-- -------- prompts --------
alter table public.prompts
  add column if not exists organization_id uuid,
  add column if not exists created_by_user_id uuid null,
  add column if not exists updated_by_user_id uuid null,
  add column if not exists visibility text not null default 'organization';

alter table public.prompts
  drop constraint if exists prompts_visibility_check;

alter table public.prompts
  add constraint prompts_visibility_check
  check (visibility in ('organization', 'private'));

alter table public.prompts
  drop constraint if exists prompts_organization_id_fkey,
  add constraint prompts_organization_id_fkey
    foreign key (organization_id) references public.organizations(id) on delete cascade;

alter table public.prompts
  drop constraint if exists prompts_created_by_user_id_fkey,
  add constraint prompts_created_by_user_id_fkey
    foreign key (created_by_user_id) references public.profiles(id) on delete set null;

alter table public.prompts
  drop constraint if exists prompts_updated_by_user_id_fkey,
  add constraint prompts_updated_by_user_id_fkey
    foreign key (updated_by_user_id) references public.profiles(id) on delete set null;

create index if not exists idx_prompts_organization_id
  on public.prompts (organization_id);

-- -------- prompt_versions --------
alter table public.prompt_versions
  add column if not exists organization_id uuid,
  add column if not exists created_by_user_id uuid null;

alter table public.prompt_versions
  drop constraint if exists prompt_versions_organization_id_fkey,
  add constraint prompt_versions_organization_id_fkey
    foreign key (organization_id) references public.organizations(id) on delete cascade;

alter table public.prompt_versions
  drop constraint if exists prompt_versions_created_by_user_id_fkey,
  add constraint prompt_versions_created_by_user_id_fkey
    foreign key (created_by_user_id) references public.profiles(id) on delete set null;

create index if not exists idx_prompt_versions_organization_id
  on public.prompt_versions (organization_id);

-- -------- tags --------
alter table public.tags
  add column if not exists organization_id uuid,
  add column if not exists created_by_user_id uuid null;

alter table public.tags
  drop constraint if exists tags_organization_id_fkey,
  add constraint tags_organization_id_fkey
    foreign key (organization_id) references public.organizations(id) on delete cascade;

alter table public.tags
  drop constraint if exists tags_created_by_user_id_fkey,
  add constraint tags_created_by_user_id_fkey
    foreign key (created_by_user_id) references public.profiles(id) on delete set null;

create index if not exists idx_tags_organization_id
  on public.tags (organization_id);

-- -------- signal_categories --------
alter table public.signal_categories
  add column if not exists organization_id uuid;

alter table public.signal_categories
  drop constraint if exists signal_categories_organization_id_fkey,
  add constraint signal_categories_organization_id_fkey
    foreign key (organization_id) references public.organizations(id) on delete cascade;

create index if not exists idx_signal_categories_organization_id
  on public.signal_categories (organization_id);

-- ============================================================
-- 6) SEED DEFAULT ORG + PROFILE + MEMBERSHIP
-- ============================================================
-- IMPORTANT:
-- Uses Supabase email anpolchert@gmail.com for initial seed/backfill (override via seed script).
-- ============================================================

do $$
declare
  v_user_id uuid;
  v_org_id uuid;
  v_email text := 'team@purrr.ai';
  v_full_name text := 'Initial Admin';
  v_org_name text := 'Default Organization';
  v_org_slug text := 'default-organization';
  v_org_type text := 'research_firm';
begin
  select id into v_user_id
  from auth.users
  where lower(email) = lower(v_email)
  limit 1;

  if v_user_id is not null then
    insert into public.profiles (id, email, full_name, status)
    values (v_user_id, v_email, v_full_name, 'active')
    on conflict (id) do update
      set email = excluded.email,
          full_name = excluded.full_name;

    insert into public.organizations (name, slug, organization_type, status, created_by_user_id)
    values (v_org_name, v_org_slug, v_org_type, 'active', v_user_id)
    on conflict (slug) do update
      set name = excluded.name
    returning id into v_org_id;
  else
    raise notice 'No auth.users row found for email %, creating default organization without owner for slug %.', v_email, v_org_slug;
    insert into public.organizations (name, slug, organization_type, status)
    values (v_org_name, v_org_slug, v_org_type, 'active')
    on conflict (slug) do update
      set name = excluded.name
    returning id into v_org_id;
  end if;

  if v_org_id is null then
    select id into v_org_id
    from public.organizations
    where slug = v_org_slug
    limit 1;
  end if;

  if v_user_id is not null then
    insert into public.organization_memberships (
      organization_id,
      user_id,
      role,
      status,
      invited_by_user_id
    )
    values (
      v_org_id,
      v_user_id,
      'org_admin',
      'active',
      v_user_id
    )
    on conflict (organization_id, user_id) do update
      set role = excluded.role,
          status = excluded.status;
  end if;

  -- backfill tenant-scoped tables
  update public.factors
  set organization_id = v_org_id
  where organization_id is null;

  update public.formulas
  set organization_id = v_org_id
  where organization_id is null;

  update public.prompts
  set organization_id = v_org_id
  where organization_id is null;

  update public.prompt_versions
  set organization_id = v_org_id
  where organization_id is null;

  update public.tags
  set organization_id = v_org_id
  where organization_id is null;

  update public.signal_categories
  set organization_id = v_org_id
  where organization_id is null;

  -- backfill creator columns where possible (only when user exists)
  if v_user_id is not null then
    update public.factors
    set created_by_user_id = coalesce(created_by_user_id, v_user_id),
        updated_by_user_id = coalesce(updated_by_user_id, v_user_id)
    where organization_id = v_org_id;

    update public.formulas
    set created_by_user_id = coalesce(created_by_user_id, v_user_id),
        updated_by_user_id = coalesce(updated_by_user_id, v_user_id)
    where organization_id = v_org_id;

    update public.prompts
    set created_by_user_id = coalesce(created_by_user_id, v_user_id),
        updated_by_user_id = coalesce(updated_by_user_id, v_user_id)
    where organization_id = v_org_id;

    update public.prompt_versions
    set created_by_user_id = coalesce(created_by_user_id, v_user_id)
    where organization_id = v_org_id;

    update public.tags
    set created_by_user_id = coalesce(created_by_user_id, v_user_id)
    where organization_id = v_org_id;
  end if;

end $$;

-- ============================================================
-- 7) SET ORGANIZATION_ID TO NOT NULL AFTER BACKFILL
-- ============================================================

alter table public.factors
  alter column organization_id set not null;

alter table public.formulas
  alter column organization_id set not null;

alter table public.prompts
  alter column organization_id set not null;

alter table public.prompt_versions
  alter column organization_id set not null;

alter table public.tags
  alter column organization_id set not null;

alter table public.signal_categories
  alter column organization_id set not null;

-- ============================================================
-- 8) ENABLE RLS
-- ============================================================

alter table public.profiles enable row level security;
alter table public.organizations enable row level security;
alter table public.organization_memberships enable row level security;
alter table public.factors enable row level security;
alter table public.formulas enable row level security;
alter table public.prompts enable row level security;
alter table public.prompt_versions enable row level security;
alter table public.tags enable row level security;
alter table public.signal_categories enable row level security;

-- ============================================================
-- 9) RLS POLICIES
-- ============================================================

-- -------- profiles --------
drop policy if exists profiles_select_own on public.profiles;
create policy profiles_select_own
on public.profiles
for select
to authenticated
using (id = auth.uid());

drop policy if exists profiles_update_own on public.profiles;
create policy profiles_update_own
on public.profiles
for update
to authenticated
using (id = auth.uid())
with check (id = auth.uid());

drop policy if exists profiles_insert_own on public.profiles;
create policy profiles_insert_own
on public.profiles
for insert
to authenticated
with check (id = auth.uid());

-- -------- organizations --------
drop policy if exists organizations_select_member on public.organizations;
create policy organizations_select_member
on public.organizations
for select
to authenticated
using (
  exists (
    select 1
    from public.organization_memberships om
    where om.organization_id = organizations.id
      and om.user_id = auth.uid()
      and om.status = 'active'
  )
);

drop policy if exists organizations_insert_member on public.organizations;
create policy organizations_insert_member
on public.organizations
for insert
to authenticated
with check (created_by_user_id = auth.uid());

drop policy if exists organizations_update_admin on public.organizations;
create policy organizations_update_admin
on public.organizations
for update
to authenticated
using (
  exists (
    select 1
    from public.organization_memberships om
    where om.organization_id = organizations.id
      and om.user_id = auth.uid()
      and om.role = 'org_admin'
      and om.status = 'active'
  )
)
with check (
  exists (
    select 1
    from public.organization_memberships om
    where om.organization_id = organizations.id
      and om.user_id = auth.uid()
      and om.role = 'org_admin'
      and om.status = 'active'
  )
);

-- -------- organization_memberships --------
drop policy if exists organization_memberships_select_member on public.organization_memberships;
create policy organization_memberships_select_member
on public.organization_memberships
for select
to authenticated
using (
  exists (
    select 1
    from public.organization_memberships om
    where om.organization_id = organization_memberships.organization_id
      and om.user_id = auth.uid()
      and om.status = 'active'
  )
);

drop policy if exists organization_memberships_insert_admin on public.organization_memberships;
create policy organization_memberships_insert_admin
on public.organization_memberships
for insert
to authenticated
with check (
  exists (
    select 1
    from public.organization_memberships om
    where om.organization_id = organization_memberships.organization_id
      and om.user_id = auth.uid()
      and om.role = 'org_admin'
      and om.status = 'active'
  )
);

drop policy if exists organization_memberships_update_admin on public.organization_memberships;
create policy organization_memberships_update_admin
on public.organization_memberships
for update
to authenticated
using (
  exists (
    select 1
    from public.organization_memberships om
    where om.organization_id = organization_memberships.organization_id
      and om.user_id = auth.uid()
      and om.role = 'org_admin'
      and om.status = 'active'
  )
)
with check (
  exists (
    select 1
    from public.organization_memberships om
    where om.organization_id = organization_memberships.organization_id
      and om.user_id = auth.uid()
      and om.role = 'org_admin'
      and om.status = 'active'
  )
);

drop policy if exists organization_memberships_delete_admin on public.organization_memberships;
create policy organization_memberships_delete_admin
on public.organization_memberships
for delete
to authenticated
using (
  exists (
    select 1
    from public.organization_memberships om
    where om.organization_id = organization_memberships.organization_id
      and om.user_id = auth.uid()
      and om.role = 'org_admin'
      and om.status = 'active'
  )
);

-- -------- tenant helper pattern --------
-- Applies to: factors, formulas, prompts, prompt_versions, tags, signal_categories

-- -------- factors --------
drop policy if exists factors_select_member on public.factors;
create policy factors_select_member
on public.factors
for select
to authenticated
using (
  exists (
    select 1
    from public.organization_memberships om
    where om.organization_id = factors.organization_id
      and om.user_id = auth.uid()
      and om.status = 'active'
  )
);

drop policy if exists factors_insert_member on public.factors;
create policy factors_insert_member
on public.factors
for insert
to authenticated
with check (
  exists (
    select 1
    from public.organization_memberships om
    where om.organization_id = factors.organization_id
      and om.user_id = auth.uid()
      and om.status = 'active'
  )
);

drop policy if exists factors_update_member on public.factors;
create policy factors_update_member
on public.factors
for update
to authenticated
using (
  exists (
    select 1
    from public.organization_memberships om
    where om.organization_id = factors.organization_id
      and om.user_id = auth.uid()
      and om.status = 'active'
  )
)
with check (
  exists (
    select 1
    from public.organization_memberships om
    where om.organization_id = factors.organization_id
      and om.user_id = auth.uid()
      and om.status = 'active'
  )
);

drop policy if exists factors_delete_member on public.factors;
create policy factors_delete_member
on public.factors
for delete
to authenticated
using (
  exists (
    select 1
    from public.organization_memberships om
    where om.organization_id = factors.organization_id
      and om.user_id = auth.uid()
      and om.status = 'active'
  )
);

-- -------- formulas --------
drop policy if exists formulas_select_member on public.formulas;
create policy formulas_select_member
on public.formulas
for select
to authenticated
using (
  exists (
    select 1
    from public.organization_memberships om
    where om.organization_id = formulas.organization_id
      and om.user_id = auth.uid()
      and om.status = 'active'
  )
);

drop policy if exists formulas_insert_member on public.formulas;
create policy formulas_insert_member
on public.formulas
for insert
to authenticated
with check (
  exists (
    select 1
    from public.organization_memberships om
    where om.organization_id = formulas.organization_id
      and om.user_id = auth.uid()
      and om.status = 'active'
  )
);

drop policy if exists formulas_update_member on public.formulas;
create policy formulas_update_member
on public.formulas
for update
to authenticated
using (
  exists (
    select 1
    from public.organization_memberships om
    where om.organization_id = formulas.organization_id
      and om.user_id = auth.uid()
      and om.status = 'active'
  )
)
with check (
  exists (
    select 1
    from public.organization_memberships om
    where om.organization_id = formulas.organization_id
      and om.user_id = auth.uid()
      and om.status = 'active'
  )
);

drop policy if exists formulas_delete_member on public.formulas;
create policy formulas_delete_member
on public.formulas
for delete
to authenticated
using (
  exists (
    select 1
    from public.organization_memberships om
    where om.organization_id = formulas.organization_id
      and om.user_id = auth.uid()
      and om.status = 'active'
  )
);

-- -------- prompts --------
drop policy if exists prompts_select_member on public.prompts;
create policy prompts_select_member
on public.prompts
for select
to authenticated
using (
  exists (
    select 1
    from public.organization_memberships om
    where om.organization_id = prompts.organization_id
      and om.user_id = auth.uid()
      and om.status = 'active'
  )
);

drop policy if exists prompts_insert_member on public.prompts;
create policy prompts_insert_member
on public.prompts
for insert
to authenticated
with check (
  exists (
    select 1
    from public.organization_memberships om
    where om.organization_id = prompts.organization_id
      and om.user_id = auth.uid()
      and om.status = 'active'
  )
);

drop policy if exists prompts_update_member on public.prompts;
create policy prompts_update_member
on public.prompts
for update
to authenticated
using (
  exists (
    select 1
    from public.organization_memberships om
    where om.organization_id = prompts.organization_id
      and om.user_id = auth.uid()
      and om.status = 'active'
  )
)
with check (
  exists (
    select 1
    from public.organization_memberships om
    where om.organization_id = prompts.organization_id
      and om.user_id = auth.uid()
      and om.status = 'active'
  )
);

drop policy if exists prompts_delete_member on public.prompts;
create policy prompts_delete_member
on public.prompts
for delete
to authenticated
using (
  exists (
    select 1
    from public.organization_memberships om
    where om.organization_id = prompts.organization_id
      and om.user_id = auth.uid()
      and om.status = 'active'
  )
);

-- -------- prompt_versions --------
drop policy if exists prompt_versions_select_member on public.prompt_versions;
create policy prompt_versions_select_member
on public.prompt_versions
for select
to authenticated
using (
  exists (
    select 1
    from public.organization_memberships om
    where om.organization_id = prompt_versions.organization_id
      and om.user_id = auth.uid()
      and om.status = 'active'
  )
);

drop policy if exists prompt_versions_insert_member on public.prompt_versions;
create policy prompt_versions_insert_member
on public.prompt_versions
for insert
to authenticated
with check (
  exists (
    select 1
    from public.organization_memberships om
    where om.organization_id = prompt_versions.organization_id
      and om.user_id = auth.uid()
      and om.status = 'active'
  )
);

drop policy if exists prompt_versions_update_member on public.prompt_versions;
create policy prompt_versions_update_member
on public.prompt_versions
for update
to authenticated
using (
  exists (
    select 1
    from public.organization_memberships om
    where om.organization_id = prompt_versions.organization_id
      and om.user_id = auth.uid()
      and om.status = 'active'
  )
)
with check (
  exists (
    select 1
    from public.organization_memberships om
    where om.organization_id = prompt_versions.organization_id
      and om.user_id = auth.uid()
      and om.status = 'active'
  )
);

drop policy if exists prompt_versions_delete_member on public.prompt_versions;
create policy prompt_versions_delete_member
on public.prompt_versions
for delete
to authenticated
using (
  exists (
    select 1
    from public.organization_memberships om
    where om.organization_id = prompt_versions.organization_id
      and om.user_id = auth.uid()
      and om.status = 'active'
  )
);

-- -------- tags --------
drop policy if exists tags_select_member on public.tags;
create policy tags_select_member
on public.tags
for select
to authenticated
using (
  exists (
    select 1
    from public.organization_memberships om
    where om.organization_id = tags.organization_id
      and om.user_id = auth.uid()
      and om.status = 'active'
  )
);

drop policy if exists tags_insert_member on public.tags;
create policy tags_insert_member
on public.tags
for insert
to authenticated
with check (
  exists (
    select 1
    from public.organization_memberships om
    where om.organization_id = tags.organization_id
      and om.user_id = auth.uid()
      and om.status = 'active'
  )
);

drop policy if exists tags_update_member on public.tags;
create policy tags_update_member
on public.tags
for update
to authenticated
using (
  exists (
    select 1
    from public.organization_memberships om
    where om.organization_id = tags.organization_id
      and om.user_id = auth.uid()
      and om.status = 'active'
  )
)
with check (
  exists (
    select 1
    from public.organization_memberships om
    where om.organization_id = tags.organization_id
      and om.user_id = auth.uid()
      and om.status = 'active'
  )
);

drop policy if exists tags_delete_member on public.tags;
create policy tags_delete_member
on public.tags
for delete
to authenticated
using (
  exists (
    select 1
    from public.organization_memberships om
    where om.organization_id = tags.organization_id
      and om.user_id = auth.uid()
      and om.status = 'active'
  )
);

-- -------- signal_categories --------
drop policy if exists signal_categories_select_member on public.signal_categories;
create policy signal_categories_select_member
on public.signal_categories
for select
to authenticated
using (
  exists (
    select 1
    from public.organization_memberships om
    where om.organization_id = signal_categories.organization_id
      and om.user_id = auth.uid()
      and om.status = 'active'
  )
);

drop policy if exists signal_categories_insert_member on public.signal_categories;
create policy signal_categories_insert_member
on public.signal_categories
for insert
to authenticated
with check (
  exists (
    select 1
    from public.organization_memberships om
    where om.organization_id = signal_categories.organization_id
      and om.user_id = auth.uid()
      and om.status = 'active'
  )
);

drop policy if exists signal_categories_update_member on public.signal_categories;
create policy signal_categories_update_member
on public.signal_categories
for update
to authenticated
using (
  exists (
    select 1
    from public.organization_memberships om
    where om.organization_id = signal_categories.organization_id
      and om.user_id = auth.uid()
      and om.status = 'active'
  )
)
with check (
  exists (
    select 1
    from public.organization_memberships om
    where om.organization_id = signal_categories.organization_id
      and om.user_id = auth.uid()
      and om.status = 'active'
  )
);

drop policy if exists signal_categories_delete_member on public.signal_categories;
create policy signal_categories_delete_member
on public.signal_categories
for delete
to authenticated
using (
  exists (
    select 1
    from public.organization_memberships om
    where om.organization_id = signal_categories.organization_id
      and om.user_id = auth.uid()
      and om.status = 'active'
  )
);

commit;

