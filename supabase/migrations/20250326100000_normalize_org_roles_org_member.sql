-- Normalize organization role model: org_admin + org_member only.
-- Legacy analyst/viewer -> org_member. Super admin remains profiles.is_platform_admin (unchanged).
-- Drop role CHECK constraints before updates; old checks do not allow org_member.

begin;

-- ---------------------------------------------------------------------------
-- organization_memberships
-- ---------------------------------------------------------------------------
do $$
declare
  r record;
begin
  for r in (
    select c.conname
    from pg_constraint c
    join pg_class t on c.conrelid = t.oid
    join pg_namespace n on t.relnamespace = n.oid
    where n.nspname = 'public'
      and t.relname = 'organization_memberships'
      and c.contype = 'c'
      and pg_get_constraintdef(c.oid) like '%role%'
  ) loop
    execute format('alter table public.organization_memberships drop constraint %I', r.conname);
  end loop;
end $$;

update public.organization_memberships
set role = 'org_member', updated_at = now()
where role in ('analyst', 'viewer');

alter table public.organization_memberships
  add constraint organization_memberships_role_check
  check (role in ('org_admin', 'org_member'));

-- ---------------------------------------------------------------------------
-- organization_invitations
-- ---------------------------------------------------------------------------
do $$
declare
  r record;
begin
  for r in (
    select c.conname
    from pg_constraint c
    join pg_class t on c.conrelid = t.oid
    join pg_namespace n on t.relnamespace = n.oid
    where n.nspname = 'public'
      and t.relname = 'organization_invitations'
      and c.contype = 'c'
      and pg_get_constraintdef(c.oid) like '%role%'
  ) loop
    execute format('alter table public.organization_invitations drop constraint %I', r.conname);
  end loop;
end $$;

update public.organization_invitations
set role = 'org_member', updated_at = now()
where role in ('analyst', 'viewer');

alter table public.organization_invitations
  add constraint organization_invitations_role_check
  check (role in ('org_admin', 'org_member'));

commit;
