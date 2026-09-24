-- Dev Panel release lifecycle ledger.
-- Operational rollback/revert history belongs to Dev Panel.
-- License Manager remains the technical release/deployment authority.

create table if not exists public.panel_release_events (
  id uuid primary key default gen_random_uuid(),
  event_id text not null unique,
  event_type text not null check (event_type in ('rolled_back','rollback_failed','reverted','revert_failed','archived')),
  release_id text,
  release_version text not null,
  target_release_id text,
  target_version text,
  release_type text not null check (release_type in ('base','update')),
  channel text not null default 'stable',
  installation_id text,
  reason text not null,
  status text not null default 'recorded',
  archived boolean not null default true,
  source_system text not null default 'billing_store',
  metadata jsonb not null default '{}'::jsonb,
  occurred_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

alter table public.panel_release_events enable row level security;
revoke all on public.panel_release_events from anon, authenticated;
grant all on public.panel_release_events to service_role;

create index if not exists idx_panel_release_events_created
  on public.panel_release_events(created_at desc);
create index if not exists idx_panel_release_events_release
  on public.panel_release_events(release_id, release_version);
create index if not exists idx_panel_release_events_installation
  on public.panel_release_events(installation_id, occurred_at desc);
