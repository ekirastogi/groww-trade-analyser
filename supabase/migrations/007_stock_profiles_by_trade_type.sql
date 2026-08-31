-- Per-trade-type breakdown on stock profiles powers client-side filtering without re-querying trades.
alter table public.stock_profiles
  add column if not exists by_trade_type jsonb not null default '{}';
