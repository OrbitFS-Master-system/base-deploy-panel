-- Dev Panel access model layered onto the existing Custom License Manager users table.
-- Dev Panel authentication already uses public.users from the connected Custom License Manager Supabase.
-- Roles are intentionally limited to Owner and Admin.

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid='public.users'::regclass and conname='users_role_check_v2'
  ) then
    alter table public.users drop constraint if exists users_role_check;
    alter table public.users
      add constraint users_role_check_v2 check (role in ('owner','admin'));
  end if;
end $$;

create table if not exists public.access_groups (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  description text not null default '',
  permissions jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.user_access_groups (
  user_id uuid not null references public.users(id) on delete cascade,
  group_id uuid not null references public.access_groups(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, group_id)
);

create table if not exists public.panel_access_audit (
  id uuid primary key default gen_random_uuid(),
  actor_id uuid references public.users(id) on delete set null,
  action text not null,
  target_type text not null,
  target_id text,
  detail jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

alter table public.access_groups enable row level security;
alter table public.user_access_groups enable row level security;
alter table public.panel_access_audit enable row level security;

-- These tables are server-only. The Dev Panel backend uses the service role;
-- browser clients have no direct Data API access.
revoke all on public.access_groups from anon, authenticated;
revoke all on public.user_access_groups from anon, authenticated;
revoke all on public.panel_access_audit from anon, authenticated;

grant all on public.access_groups to service_role;
grant all on public.user_access_groups to service_role;
grant all on public.panel_access_audit to service_role;

create index if not exists idx_users_role on public.users(role);
create index if not exists idx_user_access_groups_group on public.user_access_groups(group_id);
create index if not exists idx_panel_access_audit_created on public.panel_access_audit(created_at desc);
create index if not exists idx_panel_access_audit_actor on public.panel_access_audit(actor_id);
