-- Live tracking snapshots for admin dashboard parity with the extension popup.
-- Apply this in Supabase SQL editor.

create table if not exists public.tracking_snapshots (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null unique references public.users(id) on delete cascade,
  email text,
  name text,
  current_url text,
  current_domain text,
  current_title text,
  current_time_spent integer not null default 0,
  productive_seconds integer not null default 0,
  unproductive_seconds integer not null default 0,
  total_usage_seconds integer not null default 0,
  total_visits integer not null default 0,
  productivity_percent integer not null default 0,
  websites_tracked integer not null default 0,
  most_visited_website text,
  recent_activity jsonb not null default '[]'::jsonb,
  recent_browser_history jsonb not null default '[]'::jsonb,
  updated_at timestamptz not null default now()
);

alter table public.tracking_snapshots enable row level security;

create policy "Service role can manage tracking snapshots"
  on public.tracking_snapshots
  for all
  using (auth.role() = 'service_role')
  with check (auth.role() = 'service_role');

