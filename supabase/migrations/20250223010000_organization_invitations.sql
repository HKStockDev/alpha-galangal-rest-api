begin;

-- ============================================================
-- ORGANIZATION INVITATIONS
-- Add only this if you already ran the earlier tenancy migration
-- Soft delete / revoke model via status='revoked'
-- ============================================================

create table if not exists public.organization_invitations (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  email text not null,
  role text not null
    check (role in ('org_admin', 'analyst', 'viewer')),
  status text not null default 'pending'
    check (status in ('pending', 'accepted', 'revoked', 'expired')),
  token text not null unique,
  invited_by_user_id uuid null references public.profiles(id) on delete set null,
  accepted_by_user_id uuid null references public.profiles(id) on delete set null,
  expires_at timestamptz null,
  accepted_at timestamptz null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_org_invitations_organization_id
  on public.organization_invitations (organization_id);

create index if not exists idx_org_invitations_email_lower
  on public.organization_invitations (lower(email));

create index if not exists idx_org_invitations_status
  on public.organization_invitations (status);

create unique index if not exists uq_org_invitations_pending_email
  on public.organization_invitations (organization_id, lower(email))
  where status = 'pending';

drop trigger if exists trg_organization_invitations_set_updated_at on public.organization_invitations;
create trigger trg_organization_invitations_set_updated_at
before update on public.organization_invitations
for each row
execute function public.set_updated_at();

alter table public.organization_invitations enable row level security;

-- ============================================================
-- RLS POLICIES
-- ============================================================

drop policy if exists organization_invitations_select_member on public.organization_invitations;
create policy organization_invitations_select_member
on public.organization_invitations
for select
to authenticated
using (
  exists (
    select 1
    from public.organization_memberships om
    where om.organization_id = organization_invitations.organization_id
      and om.user_id = auth.uid()
      and om.status = 'active'
  )
);

drop policy if exists organization_invitations_insert_admin on public.organization_invitations;
create policy organization_invitations_insert_admin
on public.organization_invitations
for insert
to authenticated
with check (
  exists (
    select 1
    from public.organization_memberships om
    where om.organization_id = organization_invitations.organization_id
      and om.user_id = auth.uid()
      and om.role = 'org_admin'
      and om.status = 'active'
  )
);

drop policy if exists organization_invitations_update_admin on public.organization_invitations;
create policy organization_invitations_update_admin
on public.organization_invitations
for update
to authenticated
using (
  exists (
    select 1
    from public.organization_memberships om
    where om.organization_id = organization_invitations.organization_id
      and om.user_id = auth.uid()
      and om.role = 'org_admin'
      and om.status = 'active'
  )
)
with check (
  exists (
    select 1
    from public.organization_memberships om
    where om.organization_id = organization_invitations.organization_id
      and om.user_id = auth.uid()
      and om.role = 'org_admin'
      and om.status = 'active'
  )
);

-- ============================================================
-- BACKFILL: seed an accepted invitation for the initial admin
-- ============================================================

do $$
declare
  v_user_id uuid;
  v_org_id uuid;
  v_email text := 'anpolchert@gmail.com';
begin
  select id into v_user_id
  from public.profiles
  where lower(email) = lower(v_email)
  limit 1;

  select id into v_org_id
  from public.organizations
  where slug = 'default-organization'
  limit 1;

  if v_org_id is null then
    raise notice 'No default organization found for slug default-organization, skipping invitation backfill.';
    return;
  end if;

  if v_user_id is null then
    raise notice 'No profile found for email %, skipping invitation backfill.', v_email;
    return;
  end if;

  if not exists (
    select 1
    from public.organization_invitations
    where organization_id = v_org_id
      and lower(email) = lower(v_email)
  ) then
    insert into public.organization_invitations (
      organization_id,
      email,
      role,
      status,
      token,
      invited_by_user_id,
      accepted_by_user_id,
      accepted_at
    )
    values (
      v_org_id,
      v_email,
      'org_admin',
      'accepted',
      gen_random_uuid()::text,
      v_user_id,
      v_user_id,
      now()
    );
  end if;
end $$;

commit;

