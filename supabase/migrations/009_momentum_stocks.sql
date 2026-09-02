create table if not exists public.momentum_stocks (
  id text primary key,
  user_id text not null,
  symbol text not null,
  stock_name text,
  cmp double precision,
  entry_price double precision,
  target_price double precision,
  stop_loss double precision,
  quantity int not null default 1,
  catalyst text,
  result_date text,
  notes text,
  created_at bigint not null default 0,
  updated_at bigint not null default 0,
  payload jsonb default '{}'::jsonb
);

create unique index if not exists idx_momentum_stocks_user_symbol
  on public.momentum_stocks (user_id, symbol);

create index if not exists idx_momentum_stocks_updated
  on public.momentum_stocks (user_id, updated_at desc);

alter table public.momentum_stocks enable row level security;

drop policy if exists momentum_stocks_all on public.momentum_stocks;
create policy momentum_stocks_all on public.momentum_stocks for all
  using (public.is_allowed_user() and user_id = public.firebase_user_id())
  with check (public.is_allowed_user() and user_id = public.firebase_user_id());

do $$
begin
  execute 'alter publication supabase_realtime add table public.momentum_stocks';
exception
  when duplicate_object then null;
end $$;
