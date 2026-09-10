-- Supabase schema for the Vercel <-> Render storage bridge.
-- Run this once in Supabase: SQL Editor > New query.

create table if not exists public.bot_state (
  key text primary key,
  data jsonb not null,
  updated_at timestamptz not null default now()
);

-- Allow service_role (used by the API) full access. The key is never exposed
-- client-side, so row-level security stays on; service_role bypasses RLS.
alter table public.bot_state enable row level security;

create policy "service_role all access"
  on public.bot_state
  for all
  to service_role
  using (true)
  with check (true);