-- ISIN is the unique stock identity for P&L mapping, registry rows, and a future Groww live feed.

update public.registry_stocks
  set isin = upper(trim(isin))
  where isin is not null and isin <> upper(trim(isin));

update public.trades
  set isin = upper(trim(isin))
  where isin is not null and trim(isin) <> '' and isin <> upper(trim(isin));

update public.stock_profiles
  set isin = upper(trim(isin))
  where isin is not null and trim(isin) <> '' and isin <> upper(trim(isin));

update public.unrealised_holdings
  set isin = upper(trim(isin))
  where isin is not null and trim(isin) <> '' and isin <> upper(trim(isin));

delete from public.registry_stocks r
where coalesce(trim(r.isin), '') <> ''
  and r.ctid not in (
    select distinct on (user_id, isin) ctid
    from public.registry_stocks
    where coalesce(trim(isin), '') <> ''
    order by user_id, isin, (exchange = 'NSE') desc, length(symbol) asc, symbol asc
  );

create unique index if not exists idx_registry_stocks_user_isin_unique
  on public.registry_stocks (user_id, isin)
  where isin is not null and isin <> '';

create index if not exists idx_trades_user_client_isin
  on public.trades (user_id, client_code, isin);

alter table public.stocks
  add column if not exists isin text default '';

create index if not exists idx_stocks_isin
  on public.stocks (isin)
  where isin is not null and isin <> '';

-- Copy known ISINs onto the market table so live lookups by ISIN resolve.
update public.stocks s
set isin = upper(trim(src.isin))
from (
  select distinct on (symbol) symbol, isin
  from public.registry_stocks
  where coalesce(trim(isin), '') <> ''
  order by symbol, (exchange = 'NSE') desc, length(symbol) asc, symbol asc
) src
where s.symbol = src.symbol
  and coalesce(trim(s.isin), '') = '';
