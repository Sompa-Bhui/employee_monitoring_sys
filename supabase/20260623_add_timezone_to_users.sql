-- Add timezone support for employee profiles.
-- Existing rows are intentionally left unchanged; application code falls back to Asia/Kolkata.

alter table public.users
  add column if not exists timezone text default 'Asia/Kolkata';

