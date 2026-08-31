-- Pre-aggregated daily P&L buckets (by sell date + trade type).
-- Built on upload in the UI; read by analytics/dashboard without loading all trades.

create table if not exists public.analytics_daily (
  user_id text not null,
  client_code text not null,
  sell_date text not null,
  trade_type text not null,
  trade_count int not null default 0,
  total_buy_value double precision not null default 0,
  total_sell_value double precision not null default 0,
  realised_pnl double precision not null default 0,
  allocated_charges double precision not null default 0,
  net_pnl double precision not null default 0,
  winning_trades int not null default 0,
  losing_trades int not null default 0,
  primary key (user_id, client_code, sell_date, trade_type)
);

create index if not exists idx_analytics_daily_client_date
  on public.analytics_daily (user_id, client_code, sell_date);

alter table public.analytics_daily enable row level security;

drop policy if exists analytics_daily_all on public.analytics_daily;
create policy analytics_daily_all on public.analytics_daily for all
  using (public.is_allowed_user() and user_id = public.firebase_user_id())
  with check (public.is_allowed_user() and user_id = public.firebase_user_id());
