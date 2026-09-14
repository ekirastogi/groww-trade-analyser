-- Uploads now replace every stored trade on the sell dates the file covers, instead of
-- fingerprint-deduping row by row. Record how many rows a file displaced.

alter table public.uploads
  add column if not exists trades_replaced int;

update public.uploads
  set trades_replaced = 0
  where trades_replaced is null;

alter table public.uploads
  drop column if exists duplicates_skipped;

-- Deleting a whole sell date is the hot path of every import now.
create index if not exists idx_trades_user_client_sell_date
  on public.trades (user_id, client_code, sell_date);

-- Fingerprints only existed to dedupe identical rows, which collapsed genuine repeat trades.
drop index if exists idx_trades_fingerprint;

alter table public.trades
  drop column if exists fingerprint;
