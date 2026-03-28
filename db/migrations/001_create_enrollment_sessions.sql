-- Migration: Create the enrollment_sessions table
-- Run this in the Supabase SQL Editor (Dashboard → SQL Editor)

create table if not exists enrollment_sessions (
  id text primary key,
  user_id uuid not null references profiles(id) on delete cascade,
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);

-- Enable RLS (service_role key bypasses it, but best practice)
alter table enrollment_sessions enable row level security;

-- Block direct client access — enrollment is server-side only
create policy enrollment_sessions_no_client on enrollment_sessions
  for all using (false) with check (false);
