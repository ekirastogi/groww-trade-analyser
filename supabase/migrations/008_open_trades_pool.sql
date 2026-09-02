-- Move skipped trades into a date-independent open pool.
update public.planned_trades
set
  status = 'open',
  trade_date = '__open__',
  payload = coalesce(payload, '{}'::jsonb)
    || jsonb_build_object(
      'openedFromDate', trade_date,
      'updatedAt', (extract(epoch from now()) * 1000)::bigint
    )
where status = 'skipped';

create index if not exists idx_planned_trades_open_pool
  on public.planned_trades (user_id, status, created_at desc)
  where status = 'open';
