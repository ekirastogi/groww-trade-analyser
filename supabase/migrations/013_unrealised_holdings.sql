-- Open equity positions from Groww "Unrealised" P&L sections.
-- Replaced on each upload so mark-to-market snapshots are never mixed into realised trades.

create table if not exists public.unrealised_holdings (
  user_id text not null,
  client_code text not null,
  symbol text not null,
  stock_name text,
  isin text,
  quantity double precision default 0,
  avg_buy_price double precision default 0,
  buy_value double precision default 0,
  closing_price double precision default 0,
  closing_value double precision default 0,
  unrealised_pnl double precision default 0,
  unrealised_pnl_pct double precision default 0,
  as_of_date text,
  lots jsonb default '[]'::jsonb,
  updated_at bigint not null default 0,
  primary key (user_id, client_code, symbol)
);

create index if not exists idx_unrealised_holdings_client
  on public.unrealised_holdings (user_id, client_code, unrealised_pnl desc);

alter table public.unrealised_holdings enable row level security;

drop policy if exists unrealised_holdings_all on public.unrealised_holdings;
create policy unrealised_holdings_all on public.unrealised_holdings for all
  using (public.is_allowed_user() and user_id = public.firebase_user_id())
  with check (public.is_allowed_user() and user_id = public.firebase_user_id());

do $$
begin
  execute 'alter publication supabase_realtime add table public.unrealised_holdings';
exception
  when duplicate_object then null;
end $$;
