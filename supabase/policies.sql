-- Supabase RLS policy definitions for the employee monitoring system.
-- Apply these in the Supabase SQL editor or as part of migration.

-- Enable row-level security on the users table.
alter table public.users enable row level security;

drop policy if exists "Authenticated users can read own user record" on public.users;
create policy "Authenticated users can read own user record"
  on public.users
  for select
  using (
    auth.role() = 'authenticated'
    and auth.uid() = id
  );

drop policy if exists "Authenticated users can insert own user record" on public.users;
create policy "Authenticated users can insert own user record"
  on public.users
  for insert
  with check (
    auth.role() = 'authenticated'
    and auth.uid() = id
  );

drop policy if exists "Authenticated users can update own user record" on public.users;
create policy "Authenticated users can update own user record"
  on public.users
  for update
  using (
    auth.role() = 'authenticated'
    and auth.uid() = id
  )
  with check (
    auth.role() = 'authenticated'
    and auth.uid() = id
  );

drop policy if exists "Service role can manage users" on public.users;
create policy "Service role can manage users"
  on public.users
  for all
  using (auth.role() = 'service_role')
  with check (auth.role() = 'service_role');

-- Enable row-level security on the activity_logs table.
alter table public.activity_logs enable row level security;

drop policy if exists "Authenticated users can insert own activity logs" on public.activity_logs;
create policy "Authenticated users can insert own activity logs"
  on public.activity_logs
  for insert
  with check (
    auth.role() = 'authenticated'
    and auth.uid() = user_id
  );

drop policy if exists "Authenticated users can update own activity logs" on public.activity_logs;
create policy "Authenticated users can update own activity logs"
  on public.activity_logs
  for update
  using (
    auth.role() = 'authenticated'
    and auth.uid() = user_id
  )
  with check (
    auth.role() = 'authenticated'
    and auth.uid() = user_id
  );

drop policy if exists "Authenticated users can read own activity logs" on public.activity_logs;
create policy "Authenticated users can read own activity logs"
  on public.activity_logs
  for select
  using (
    auth.role() = 'authenticated'
    and auth.uid() = user_id
  );

drop policy if exists "Service role can manage activity logs" on public.activity_logs;
create policy "Service role can manage activity logs"
  on public.activity_logs
  for all
  using (auth.role() = 'service_role')
  with check (auth.role() = 'service_role');

-- Enable row-level security on the tracking_snapshots table.
alter table public.tracking_snapshots enable row level security;

drop policy if exists "Authenticated users can insert own tracking snapshots" on public.tracking_snapshots;
create policy "Authenticated users can insert own tracking snapshots"
  on public.tracking_snapshots
  for insert
  with check (
    auth.role() = 'authenticated'
    and auth.uid() = user_id
  );

drop policy if exists "Authenticated users can update own tracking snapshots" on public.tracking_snapshots;
create policy "Authenticated users can update own tracking snapshots"
  on public.tracking_snapshots
  for update
  using (
    auth.role() = 'authenticated'
    and auth.uid() = user_id
  )
  with check (
    auth.role() = 'authenticated'
    and auth.uid() = user_id
  );

drop policy if exists "Authenticated users can read own tracking snapshots" on public.tracking_snapshots;
create policy "Authenticated users can read own tracking snapshots"
  on public.tracking_snapshots
  for select
  using (
    auth.role() = 'authenticated'
    and auth.uid() = user_id
  );

drop policy if exists "Service role can manage tracking snapshots" on public.tracking_snapshots;
create policy "Service role can manage tracking snapshots"
  on public.tracking_snapshots
  for all
  using (auth.role() = 'service_role')
  with check (auth.role() = 'service_role');
