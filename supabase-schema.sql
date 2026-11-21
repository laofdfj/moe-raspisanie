-- Справочная схема для Supabase. В проекте пользователя миграция уже применена.
create table if not exists public.user_schedules (
  user_id uuid primary key references auth.users(id) on delete cascade,
  data jsonb not null,
  updated_at timestamptz not null default now()
);

alter table public.user_schedules enable row level security;

drop policy if exists "Users can read own schedule" on public.user_schedules;
create policy "Users can read own schedule"
  on public.user_schedules for select to authenticated
  using ((select auth.uid()) = user_id);

drop policy if exists "Users can insert own schedule" on public.user_schedules;
create policy "Users can insert own schedule"
  on public.user_schedules for insert to authenticated
  with check ((select auth.uid()) = user_id);

drop policy if exists "Users can update own schedule" on public.user_schedules;
create policy "Users can update own schedule"
  on public.user_schedules for update to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

revoke all on table public.user_schedules from anon, public;
grant select, insert, update on table public.user_schedules to authenticated;

-- Не разрешаем вызывать служебную функцию авто-включения RLS из клиентских ролей.
revoke execute on function public.rls_auto_enable() from public, anon, authenticated;

-- Добавляем таблицу в Realtime только если её там ещё нет.
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'user_schedules'
  ) then
    alter publication supabase_realtime add table public.user_schedules;
  end if;
end
$$;
