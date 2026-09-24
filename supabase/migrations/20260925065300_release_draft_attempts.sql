create table if not exists public.panel_release_drafts (
  id uuid primary key default gen_random_uuid(),
  release_type text not null check (release_type in ('base','update')),
  version text not null,
  channel text not null default 'stable',
  source_repo text not null,
  source_ref text not null,
  source_sha text,
  status text not null default 'draft' check (status in ('draft','building','failed','handed_off','archived','rejected')),
  latest_attempt integer not null default 0,
  last_error text,
  last_run_id bigint,
  last_run_url text,
  inputs jsonb not null default '{}'::jsonb,
  created_by text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  archived_at timestamptz,
  unique(release_type,version,channel)
);

create table if not exists public.panel_release_attempts (
  id uuid primary key default gen_random_uuid(),
  draft_id uuid not null references public.panel_release_drafts(id) on delete cascade,
  attempt_number integer not null,
  run_id bigint,
  run_url text,
  status text not null default 'queued' check (status in ('queued','in_progress','success','failure','cancelled','skipped')),
  error_summary text,
  error_output text,
  created_at timestamptz not null default now(),
  completed_at timestamptz,
  unique(draft_id,attempt_number)
);

create index if not exists panel_release_attempts_draft_idx on public.panel_release_attempts(draft_id,attempt_number desc);
create index if not exists panel_release_drafts_state_idx on public.panel_release_drafts(status,updated_at desc);
