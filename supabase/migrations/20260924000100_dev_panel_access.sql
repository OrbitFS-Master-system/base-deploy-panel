-- Dev Panel local access model.
-- This is intentionally separate from licensing/release authority.
-- Owner manages users, groups and permissions. Admin is operational only.

create extension if not exists pgcrypto;

create table if not exists public.users (
  id uuid primary key default gen_random_uuid(),
  email text not null unique,
  password_hash text not null,
  password_salt text not null,
  display_name text not null,
  role text not null default 'admin' check (role in ('owner','admin')),
  status text not null default 'active' check (status in ('active','disabled')),
  last_login_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

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

alter table public.users enable row level security;
alter table public.access_groups enable row level security;
alter table public.user_access_groups enable row level security;
alter table public.panel_access_audit enable row level security;

revoke all on public.users from anon, authenticated;
revoke all on public.access_groups from anon, authenticated;
revoke all on public.user_access_groups from anon, authenticated;
revoke all on public.panel_access_audit from anon, authenticated;

grant all on public.users to service_role;
grant all on public.access_groups to service_role;
grant all on public.user_access_groups to service_role;
grant all on public.panel_access_audit to service_role;

create index if not exists idx_users_status on public.users(status);
create index if not exists idx_users_role on public.users(role);
create index if not exists idx_user_access_groups_group on public.user_access_groups(group_id);
create index if not exists idx_panel_access_audit_created on public.panel_access_audit(created_at desc);
