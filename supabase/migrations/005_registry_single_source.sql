-- Single stock registry: merge universe metadata into registry_stocks and drop universe.

alter table public.registry_stocks
  add column if not exists isin text default '',
  add column if not exists exchange text default 'NSE',
  add column if not exists source text not null default 'manual';

create index if not exists idx_registry_stocks_isin on public.registry_stocks (user_id, isin);

-- Remove universe from realtime (table dropped below).
do $$
begin
  begin
    alter publication supabase_realtime drop table public.universe;
  exception
    when undefined_table then null;
    when undefined_object then null;
  end;
end $$;

drop policy if exists universe_read on public.universe;
drop policy if exists universe_write on public.universe;
drop policy if exists universe_update on public.universe;
drop table if exists public.universe;
