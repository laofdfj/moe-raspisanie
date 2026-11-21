-- Запустить один раз в Supabase SQL Editor.
create table if not exists public.user_schedules (
  user_id uuid primary key references auth.users(id) on delete cascade,
  data jsonb not null,
  updated_at timestamptz not null default now()
);
alter table public.user_schedules enable row level security;
drop policy if exists "Users can read own schedule" on public.user_schedules;
create policy "Users can read own schedule" on public.user_schedules
  for select to authenticated using (auth.uid() = user_id);
drop policy if exists "Users can insert own schedule" on public.user_schedules;
create policy "Users can insert own schedule" on public.user_schedules
  for insert to authenticated with check (auth.uid() = user_id);
drop policy if exists "Users can update own schedule" on public.user_schedules;
create policy "Users can update own schedule" on public.user_schedules
  for update to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);
alter publication supabase_realtime add table public.user_schedules;
